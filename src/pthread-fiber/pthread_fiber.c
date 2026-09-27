/*
 * Cooperative pthread_* shim for the st core, built on Emscripten fibers.
 *
 * The st core has no SharedArrayBuffer, so there is no real concurrency
 * available. FFmpeg n9's fftools scheduler (fftools/ffmpeg_sched.c) still
 * calls real pthread_create/mutex/cond APIs, so this file gives every
 * "thread" its own cooperatively-scheduled fiber: exactly one fiber's C code
 * runs at a time, and control only passes to another fiber at an explicit
 * blocking point (mutex contention, cond wait, join, sleep).
 *
 * Every symbol here is reached via linker wrapping (`-Wl,--wrap=pthread_create`
 * etc., see build/ffmpeg-wasm.sh), not by FFmpeg including pthread_fiber.h.
 * That keeps this shim from colliding with emscripten's own non-pthread
 * libc stub (system/lib/pthread/library_pthread_stub.c), which defines
 * several of these names as plain strong symbols; wrapping redirects only
 * the symbols we actually replace and leaves the rest of that stub object
 * (pthread_rwlock_*, sem_*, barriers) untouched.
 */

#include <emscripten/fiber.h>
#include <emscripten/emscripten.h>
#include <emscripten/stack.h>

#include <pthread.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define PFIBER_MAX 48
/* 8MB per worker fiber's C stack. At 2MB the filter task overflowed: it
 * carries the deepest chain in the program (filter_thread -> read_frames ->
 * ... -> avcodec_open2 -> ... -> av_log), and the overflow corrupted the heap
 * silently rather than faulting. Raise it if a future FFmpeg needs more.
 *
 * The asyncify stack is separate and is what emscripten_fiber_swap unwinds
 * into. It has to hold the same chain, hence the same size. This is per fiber
 * and unrelated to -sASYNCIFY_STACK_SIZE, which sizes the single module-wide
 * stack that only emscripten_sleep() uses, and nothing here calls that. */
#define PFIBER_STACK_SIZE (8 * 1024 * 1024)
#define PFIBER_ASYNCIFY_STACK_SIZE (1024 * 1024)
/* g_main runs the whole of main() on the module's 5MB stack, so its asyncify
 * stack has to hold an unwind of wherever it happens to be when it blocks,
 * which is deep: ffmpeg_opt_run -> transcode -> scheduler_run -> sch_wait ->
 * pthread_cond_timedwait -> the scheduler. 64KB was not enough, and
 * overflowing this does not fault: the unwind writes past the region and the
 * damage surfaces somewhere unrelated later. */
#define PFIBER_MAIN_ASYNCIFY_STACK_SIZE (1024 * 1024)

typedef struct pfiber {
    emscripten_fiber_t ctx;
    char *c_stack;
    char *asyncify_stack;
    size_t c_stack_size;
    size_t asyncify_stack_size;
    enum { PF_FREE, PF_RUNNABLE, PF_BLOCKED, PF_DONE } state;
    void *(*start_routine)(void *);
    void *arg;
    void *retval;
    int detached;
    struct pfiber *join_waiter;  /* fiber blocked in pthread_join on this one */
    void *wait_on;               /* mutex/cond pointer this fiber is blocked on */
    int has_deadline;            /* set while blocked in pthread_cond_timedwait */
    double deadline_ms;          /* pf_now_ms() value this fiber's wait expires at */
    int woke_by_timeout;         /* set by the scheduler when it expires a deadline */
} pfiber_t;

static pfiber_t g_table[PFIBER_MAX];
static pfiber_t g_main;
static pfiber_t *g_current = NULL;
static int g_initialized = 0;

/* Backing struct for a pthread_mutex_t. The opaque musl struct is treated as
 * a lazily-allocated pointer to one of these, stored in its first
 * sizeof(void*) bytes (a zero-initialized PTHREAD_MUTEX_INITIALIZER mutex
 * therefore reliably means "not yet allocated").
 *
 * epoch is bumped by every pfiber_reset(). Most of FFmpeg's mutexes are
 * file-scope statics, so the block behind one outlives the exec() that filled
 * it, and with it the owner left by a fiber that was mid-lock when that exec
 * ended. A later exec() then blocks forever on a lock held by a fiber that no
 * longer exists, because nothing is ever going to unlock it. */
typedef struct {
    pfiber_t *owner;
    unsigned epoch;
} pf_mutex_t;

static unsigned g_epoch = 1;

/* Same idea for pthread_cond_t; the struct itself carries no state beyond
 * existing, since which fibers are waiting lives in pfiber_t.wait_on. */
typedef struct {
    int allocated;
} pf_cond_t;

static pfiber_t *pfiber_at(int idx)
{
    return idx < 0 ? &g_main : &g_table[idx];
}

/* Spin until a pthread_cond_timedwait deadline comes due, or until
 * `wake_at_ms` (0 meaning "no deadline of my own"), then return so the
 * caller's scheduler loop can re-pick who runs.
 *
 * This cannot yield to the browser, and the reason is specific. Emscripten
 * implements emscripten_fiber_swap in src/lib/libasync.js: the swap unwinds
 * the outgoing fiber to JS and the trampoline rewinds into the incoming one,
 * which leaves Asyncify.state at Rewinding for as long as any fiber's C code
 * is running. emscripten_sleep() reaches Asyncify.handleSleep(), which only
 * starts a sleep when the state is Normal; in the Rewinding state it takes the
 * "stop a resume" branch instead, calls _asyncify_stop_rewind(), frees
 * currData, and returns without sleeping at all. That leaves the rewound
 * fiber stack live with its asyncify data gone. Spinning is the only correct
 * option short of not using fibers.
 *
 * So the spin is bounded rather than open-ended. It is only ever waiting for a
 * deadline, and FFmpeg's are short (ffmpeg_sched's sch_wait() polls every
 * 5ms). A wait that outlasts PF_STALL_REPORT_MS with nothing becoming runnable
 * is reported fiber by fiber, so a stall is diagnosable from a log instead of
 * being a frozen tab, and one with no deadline pending at all is a real
 * deadlock and aborts.
 */
#define PF_STALL_REPORT_MS 5000
/* Passes between clock reads. See pf_idle_wait. */
#define PF_IDLE_CLOCK_EVERY 4096

static double pf_now_ms(void);
static int pfiber_index_of(pfiber_t *f);

/* Straight to console.error, not stderr. stderr in this module is
 * Module.printErr, which is Module.logger, and every caller that runs a
 * transcode either leaves that a no-op or replaces it with a progress
 * handler, so a stall report written there is discarded and the run just looks
 * like a hang. */
EM_JS(void, pf_report_js, (const char *s), { console.error(UTF8ToString(s)); });

/* Writes every fiber's state and what it is blocked on, so a stall says who is
 * waiting on whom instead of just hanging. */
static void pf_report_stall(double waited_ms)
{
    static const char *names[] = { "free", "runnable", "blocked", "done" };
    char buf[2048];
    int n = snprintf(buf, sizeof(buf),
                     "pthread-fiber: stalled for %.0fms. fibers:", waited_ms);
    for (int i = -1; i < PFIBER_MAX; i++) {
        pfiber_t *f = pfiber_at(i);
        if (f->state == PF_FREE)
            continue;
        n += snprintf(buf + n, sizeof(buf) - n, " [%d %s on %p%s]",
                      pfiber_index_of(f), names[f->state], f->wait_on,
                      f->has_deadline ? " timed" : "");
        if (n >= (int)sizeof(buf) - 96)
            break;
    }
    snprintf(buf + n, sizeof(buf) - n, "\n");
    pf_report_js(buf);
}

static void pf_idle_wait(double wake_at_ms)
{
    double started = pf_now_ms();
    double reported = started;
    double now = started;

    /* Sample the clock in batches, not every pass. pf_now_ms is a clock_gettime,
     * which is a JavaScript import under Emscripten, so reading it on every
     * iteration turns a five millisecond wait into millions of JS calls and
     * makes a whole transcode look like a hang. */
    for (unsigned long long i = 0;; i++) {
        if (i % PF_IDLE_CLOCK_EVERY == 0) {
            now = pf_now_ms();
            for (int k = -1; k < PFIBER_MAX; k++) {
                pfiber_t *f = pfiber_at(k);
                if (f->state == PF_BLOCKED && f->has_deadline) {
                    if (now >= f->deadline_ms) {
                        f->wait_on = NULL;
                        f->has_deadline = 0;
                        f->woke_by_timeout = 1;
                        f->state = PF_RUNNABLE;
                    }
                }
            }
        }

        int something_can_wake_us = wake_at_ms > 0;
        for (int k = -1; k < PFIBER_MAX; k++) {
            pfiber_t *f = pfiber_at(k);
            if (f->state == PF_BLOCKED && f->has_deadline)
                something_can_wake_us = 1;
        }
        if (!something_can_wake_us) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                     "pthread-fiber: no fiber is runnable and none has a "
                     "pending deadline, so nothing can ever run again.\n");
            pf_report_js(msg);
            abort();
        }

        if (wake_at_ms > 0 && now >= wake_at_ms)
            return;

        /* Nothing became runnable. Normally that costs one deadline, a few
         * milliseconds. Needing far longer than any deadline FFmpeg arms means
         * the wait is not going to end, so report it rather than freezing the
         * page. */
        if (now - reported > PF_STALL_REPORT_MS) {
            pf_report_stall(now - started);
            reported = now;
        }
    }
}

static int pfiber_index_of(pfiber_t *f)
{
    return (f == &g_main) ? -1 : (int)(f - g_table);
}

/* Wall-clock milliseconds, matching av_gettime()'s gettimeofday() basis:
 * fftools builds pthread_cond_timedwait's abstime from av_gettime(), so this
 * needs to be comparable to that, not CLOCK_MONOTONIC. */
static double pf_now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

/*
 * (Re)capture the main fiber's context. Called at the start of every top-level
 * invocation, not just the first one.
 *
 * This has to be repeatable. bind.js wraps each exec()/ffprobe() in
 * stackSave()/stackRestore(), because ffmpeg finishes by calling exit(), which
 * Emscripten implements by throwing, and nothing unwinds the wasm stack for
 * it. So each call runs on a stack pointer the previous call moved and then
 * put back, while emscripten_fiber_init_from_current_context() captures the
 * stack pointer as it is right now. Capture it once and every later call
 * inherits a context that describes a stack frame which no longer exists:
 * the first exec() transcodes fine and the second spins at 100% CPU during
 * startup, where neither the browser nor Node can pause it, because it never
 * reaches a safepoint.
 *
 * Freeing the table entries here is safe even if the previous call died with
 * fibers still marked runnable: clearing g_table leaves no pointer to them, so
 * the scheduler can never select one again, and a fiber's own stack must not be
 * freed by the fiber itself, which is why this runs here and not in the
 * trampoline.
 */
static void pfiber_reset(void)
{
    for (int i = 0; i < PFIBER_MAX; i++) {
        free(g_table[i].c_stack);
        free(g_table[i].asyncify_stack);
    }
    memset(g_table, 0, sizeof(g_table));
    g_epoch++;

    /* The old g_main.asyncify_stack is reachable through the memset below, so
     * free it first. Without this every exec() leaks a megabyte, and an
     * application that runs ffmpeg thousands of times runs the heap out. */
    free(g_main.asyncify_stack);
    memset(&g_main, 0, sizeof(g_main));
    g_main.state = PF_RUNNABLE;
    g_main.asyncify_stack = malloc(PFIBER_MAIN_ASYNCIFY_STACK_SIZE);
    g_main.asyncify_stack_size = PFIBER_MAIN_ASYNCIFY_STACK_SIZE;
    emscripten_fiber_init_from_current_context(&g_main.ctx, g_main.asyncify_stack,
                                                g_main.asyncify_stack_size);
    g_current = &g_main;
    g_initialized = 1;
}

/* Exported so bind.js can call it at the top of exec()/ffprobe(). Declared
 * without pthread_fiber.h on the FFmpeg side because the linker --wrap flags
 * are what pull this file in; see the comment at the top of the file. */
void pfiber_begin_call(void)
{
    pfiber_reset();
}

static void pfiber_ensure_main(void)
{
    if (!g_initialized)
        pfiber_reset();
}

/* Wake every fiber blocked on the given mutex/cond pointer. Waking more than
 * the eventual winner (for a mutex) is harmless: the loser just re-blocks on
 * its next check. A cond_signal that wakes every waiter instead of exactly
 * one is a deliberate simplification: FFmpeg's callers already loop on their
 * own predicate, so an extra spurious wakeup is legal pthread_cond_wait
 * behavior, not a bug. */
static void pf_wake_waiters_on(void *ptr)
{
    for (int i = -1; i < PFIBER_MAX; i++) {
        pfiber_t *f = pfiber_at(i);
        if (f->state == PF_BLOCKED && f->wait_on == ptr) {
            f->wait_on = NULL;
            f->state = PF_RUNNABLE;
        }
    }
}

/*
 * The scheduler. Called from every blocking point. On each pass:
 *  1. Free the stacks of any finished, detached fiber (must happen here,
 *     never inside the exiting fiber itself, since a fiber must not free
 *     its own currently-in-use stack).
 *  2. Round-robin to the next PF_RUNNABLE fiber other than the current one.
 *  3. If one exists, swap to it.
 *  4. If none exists and the caller was only voluntarily yielding (still
 *     PF_RUNNABLE), just return.
 *  5. If none exists and the caller is genuinely blocked, spin until a
 *     deadline expires (pf_idle_wait), then retry. pf_idle_wait reports and
 *     aborts if nothing is runnable and no deadline is pending, so a real
 *     deadlock fails loudly instead of hanging.
 */
static void pfiber_reschedule(void)
{
    for (;;) {
        for (int i = 0; i < PFIBER_MAX; i++) {
            pfiber_t *f = &g_table[i];
            if (f->state == PF_DONE && f->detached &&
                (f->c_stack || f->asyncify_stack)) {
                free(f->c_stack);
                free(f->asyncify_stack);
                f->c_stack = NULL;
                f->asyncify_stack = NULL;
                f->state = PF_FREE;
            }
        }

        /*
         * Expire any pthread_cond_timedwait whose deadline has passed. This
         * must happen here, in the scheduler itself, not just as a check in
         * cond_timedwait's own retry loop: that loop only gets control back
         * via this function returning, and the loop below only returns
         * control to a fiber by finding it PF_RUNNABLE. A fiber that put
         * itself to sleep as PF_BLOCKED with a deadline would otherwise
         * never be picked again once no *other* fiber is runnable either,
         * since nothing marks it runnable on its behalf -- that was the
         * st core's transcode hang: main's sch_wait() timedwait parked
         * forever once every worker fiber was also blocked, because nobody
         * ever declared the deadline itself as a reason to run again.
         */
        for (int i = -1; i < PFIBER_MAX; i++) {
            pfiber_t *f = pfiber_at(i);
            if (f->state == PF_BLOCKED && f->has_deadline && pf_now_ms() >= f->deadline_ms) {
                f->wait_on = NULL;
                f->has_deadline = 0;
                f->woke_by_timeout = 1;
                f->state = PF_RUNNABLE;
            }
        }

        int total = PFIBER_MAX + 1; /* +1 for g_main */
        int start_lin = pfiber_index_of(g_current) + 1;
        pfiber_t *next = NULL;
        int lin = start_lin;
        for (int step = 0; step < total; step++) {
            lin = (lin + 1) % total;
            if (lin == start_lin)
                break;
            pfiber_t *cand = pfiber_at(lin - 1);
            if (cand->state == PF_RUNNABLE) {
                next = cand;
                break;
            }
        }

        if (next) {
            pfiber_t *prev = g_current;
            g_current = next;
            /* emscripten_fiber_swap does not update the stack-overflow
             * checker's bounds (see emscripten/system/lib/libc/
             * emscripten_fiber.c: only *_init sets fiber->stack_base/limit,
             * swap never calls emscripten_stack_set_limits). Without this,
             * -sSTACK_OVERFLOW_CHECK validates every fiber's stack pointer
             * against whichever fiber happened to set the limits last,
             * catching nothing real. Point it at the fiber we are about to
             * run, then restore our own once we get control back. */
            emscripten_stack_set_limits(next->ctx.stack_base, next->ctx.stack_limit);
            emscripten_fiber_swap(&prev->ctx, &next->ctx);
            emscripten_stack_set_limits(prev->ctx.stack_base, prev->ctx.stack_limit);
            return;
        }

        if (g_current->state == PF_RUNNABLE)
            return;

        pf_idle_wait(0);
    }
}

/* Entry point for every worker fiber. Never returns: once a fiber's
 * start_routine finishes there is nothing left to return to, so it just
 * parks itself by looping on the scheduler forever. state == PF_DONE keeps
 * the scheduler from ever selecting it again. This looks like a bug at a
 * glance; it is not. */
static void pfiber_trampoline(void *arg)
{
    pfiber_t *f = (pfiber_t *)arg;

    f->retval = f->start_routine(f->arg);
    f->state = PF_DONE;
    if (f->join_waiter) {
        f->join_waiter->state = PF_RUNNABLE;
        f->join_waiter = NULL;
    }

    /* Never returns: a fiber that has finished has nothing to return to.
     * PF_DONE keeps the scheduler from selecting it again, so this loop only
     * runs while this fiber is still the current one, and the next pass hands
     * control to whoever is runnable.
     *
     * A fiber that is never joined and never detached leaks its two stacks
     * until the next pfiber_reset(), which frees every table entry. That
     * bounds the leak to one exec(), and ffmpeg_sched joins all of its tasks. */
    for (;;)
        pfiber_reschedule();
}

int __wrap_pthread_create(pthread_t *thread, const pthread_attr_t *attr,
                           void *(*start_routine)(void *), void *arg)
{
    (void)attr;
    pfiber_ensure_main();

    pfiber_t *f = NULL;
    for (int i = 0; i < PFIBER_MAX; i++) {
        if (g_table[i].state == PF_FREE) {
            f = &g_table[i];
            break;
        }
    }
    if (!f)
        return EAGAIN;

    char *c_stack = malloc(PFIBER_STACK_SIZE);
    char *asyncify_stack = malloc(PFIBER_ASYNCIFY_STACK_SIZE);
    if (!c_stack || !asyncify_stack) {
        free(c_stack);
        free(asyncify_stack);
        return EAGAIN;
    }

    memset(f, 0, sizeof(*f));
    f->c_stack = c_stack;
    f->asyncify_stack = asyncify_stack;
    f->c_stack_size = PFIBER_STACK_SIZE;
    f->asyncify_stack_size = PFIBER_ASYNCIFY_STACK_SIZE;
    f->start_routine = start_routine;
    f->arg = arg;

    emscripten_fiber_init(&f->ctx, pfiber_trampoline, f, c_stack, PFIBER_STACK_SIZE,
                           asyncify_stack, PFIBER_ASYNCIFY_STACK_SIZE);
    f->state = PF_RUNNABLE;

    /* Do not swap to it now; the caller (fftools sets up all its threads up
     * front, then immediately blocks) will hand it a turn on its own next
     * blocking point. */
    *thread = (pthread_t)(uintptr_t)f;
    return 0;
}

int __wrap_pthread_join(pthread_t thread, void **retval)
{
    pfiber_ensure_main();
    pfiber_t *f = (pfiber_t *)(uintptr_t)thread;

    f->join_waiter = g_current;
    g_current->state = PF_BLOCKED;
    while (f->state != PF_DONE)
        pfiber_reschedule();
    g_current->state = PF_RUNNABLE;

    if (retval)
        *retval = f->retval;

    /* Safe here: we are not running on f's stack, we are the joiner. */
    free(f->c_stack);
    free(f->asyncify_stack);
    f->c_stack = NULL;
    f->asyncify_stack = NULL;
    f->state = PF_FREE;
    return 0;
}

int __wrap_pthread_detach(pthread_t thread)
{
    pfiber_t *f = (pfiber_t *)(uintptr_t)thread;
    f->detached = 1;
    if (f->state == PF_DONE) {
        free(f->c_stack);
        free(f->asyncify_stack);
        f->c_stack = NULL;
        f->asyncify_stack = NULL;
        f->state = PF_FREE;
    }
    return 0;
}

pthread_t __wrap_pthread_self(void)
{
    pfiber_ensure_main();
    return (pthread_t)(uintptr_t)g_current;
}

int __wrap_pthread_equal(pthread_t a, pthread_t b)
{
    return a == b;
}

int __wrap_pthread_once(pthread_once_t *once_control, void (*init_routine)(void))
{
    /* Only one fiber's C code ever executes at a time, so there is no real
     * concurrency to guard against here. */
    if (*once_control == 0) {
        *once_control = 1;
        init_routine();
    }
    return 0;
}

static pf_mutex_t *pf_mutex_ensure(pthread_mutex_t *mutex)
{
    pf_mutex_t **slot = (pf_mutex_t **)(void *)mutex;
    if (!*slot || (*slot)->epoch != g_epoch) {
        /* Free the stale block: it is small, but an application that runs
         * ffmpeg in a loop would otherwise accumulate one per mutex per call. */
        free(*slot);
        *slot = calloc(1, sizeof(pf_mutex_t));
        if (*slot)
            (*slot)->epoch = g_epoch;
    }
    return *slot;
}

int __wrap_pthread_mutex_init(pthread_mutex_t *mutex, const pthread_mutexattr_t *attr)
{
    /* attr (e.g. PTHREAD_MUTEX_ERRORCHECK) is ignored: not needed for this
     * shim, and FFmpeg only relies on it when ASSERT_LEVEL is enabled, which
     * it is not by default here. */
    (void)attr;
    pf_mutex_t **slot = (pf_mutex_t **)(void *)mutex;
    free(*slot);
    *slot = calloc(1, sizeof(pf_mutex_t));
    if (*slot)
        (*slot)->epoch = g_epoch;
    return 0;
}

int __wrap_pthread_mutex_destroy(pthread_mutex_t *mutex)
{
    pf_mutex_t **slot = (pf_mutex_t **)(void *)mutex;
    free(*slot);
    *slot = NULL;
    return 0;
}

int __wrap_pthread_mutex_lock(pthread_mutex_t *mutex)
{
    pfiber_ensure_main();
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    if (m->owner == g_current) {
        /* A non-recursive lock taken twice by the same fiber can never be
         * satisfied: the wait below would block on a lock this fiber holds,
         * and no other fiber can release it. av_log() holds a static mutex,
         * so this is where a re-entrant log call would otherwise hang the
         * core with nothing to show for it. */
        fprintf(stderr,
                "pthread-fiber: fiber %d locked a mutex it already holds "
                "(%p). The lock is not recursive, so this can never be "
                "satisfied.\n",
                pfiber_index_of(g_current), (void *)mutex);
        abort();
    }
    if (m->owner != NULL)
    while (m->owner != NULL) {
        g_current->wait_on = (void *)mutex;
        g_current->state = PF_BLOCKED;
        pfiber_reschedule();
        g_current->wait_on = NULL;
        g_current->state = PF_RUNNABLE;
    }
    m->owner = g_current;
    return 0;
}

int __wrap_pthread_mutex_trylock(pthread_mutex_t *mutex)
{
    pfiber_ensure_main();
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    /* Non-recursive: FFmpeg does not rely on relocking here. A re-lock by
     * the current owner behaves like any other contended lock (EBUSY). */
    if (m->owner != NULL)
        return EBUSY;
    m->owner = g_current;
    return 0;
}

int __wrap_pthread_mutex_unlock(pthread_mutex_t *mutex)
{
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    m->owner = NULL;
    pf_wake_waiters_on((void *)mutex);
    return 0;
}

static pf_cond_t *pf_cond_ensure(pthread_cond_t *cond)
{
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    if (!*slot)
        *slot = calloc(1, sizeof(pf_cond_t));
    return *slot;
}

int __wrap_pthread_cond_init(pthread_cond_t *cond, const pthread_condattr_t *attr)
{
    (void)attr;
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    free(*slot);
    *slot = calloc(1, sizeof(pf_cond_t));
    return 0;
}

int __wrap_pthread_cond_destroy(pthread_cond_t *cond)
{
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    free(*slot);
    *slot = NULL;
    return 0;
}

int __wrap_pthread_cond_wait(pthread_cond_t *cond, pthread_mutex_t *mutex)
{
    pfiber_ensure_main();
    pf_cond_ensure(cond);
    void *cond_ptr = (void *)cond;

    __wrap_pthread_mutex_unlock(mutex);
    g_current->wait_on = cond_ptr;
    g_current->state = PF_BLOCKED;
    while (g_current->wait_on == cond_ptr)
        pfiber_reschedule();

    __wrap_pthread_mutex_lock(mutex);
    return 0;
}

int __wrap_pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex,
                                   const struct timespec *abstime)
{
    pfiber_ensure_main();
    pf_cond_ensure(cond);
    void *cond_ptr = (void *)cond;
    double deadline = (double)abstime->tv_sec * 1000.0 + (double)abstime->tv_nsec / 1e6;

    __wrap_pthread_mutex_unlock(mutex);
    g_current->wait_on = cond_ptr;
    g_current->has_deadline = 1;
    g_current->deadline_ms = deadline;
    g_current->woke_by_timeout = 0;
    g_current->state = PF_BLOCKED;
    /* pf_idle_wait is what expires `deadline` when no other fiber is
     * runnable, so this loop cannot park forever. */
    while (g_current->wait_on == cond_ptr)
        pfiber_reschedule();
    g_current->has_deadline = 0;

    __wrap_pthread_mutex_lock(mutex);
    return g_current->woke_by_timeout ? ETIMEDOUT : 0;
}

int __wrap_pthread_cond_signal(pthread_cond_t *cond)
{
    pf_wake_waiters_on((void *)cond);
    return 0;
}

int __wrap_pthread_cond_broadcast(pthread_cond_t *cond)
{
    pf_wake_waiters_on((void *)cond);
    return 0;
}

int __wrap_usleep(unsigned usec)
{
    pfiber_ensure_main();
    double deadline = emscripten_get_now() + (double)usec / 1000.0;
    while (emscripten_get_now() < deadline) {
        pfiber_reschedule();
        if (emscripten_get_now() < deadline)
            pf_idle_wait(deadline);
    }
    return 0;
}

int __wrap_nanosleep(const struct timespec *req, struct timespec *rem)
{
    pfiber_ensure_main();
    double deadline = emscripten_get_now() + (double)req->tv_sec * 1000.0 +
                       (double)req->tv_nsec / 1e6;
    while (emscripten_get_now() < deadline) {
        pfiber_reschedule();
        if (emscripten_get_now() < deadline)
            pf_idle_wait(deadline);
    }
    if (rem) {
        rem->tv_sec = 0;
        rem->tv_nsec = 0;
    }
    return 0;
}
