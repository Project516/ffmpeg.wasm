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

/* Threads a single FFmpeg run can have alive at once: one per demuxer,
 * decoder, filtergraph, encoder and muxer, which for a transcode of any
 * complexity is well under a dozen. Overridable at build time for the ones
 * that are not.
 *
 * The cost is per live fiber, not per slot: a fiber allocates its C stack and
 * asyncify stack on creation and frees them when it is reaped, so a run with
 * three threads alive at once pays for three, not for PFIBER_MAX. The ceiling
 * therefore bounds what a single run may create rather than what it reserves,
 * and __wrap_pthread_create reports it and returns EAGAIN rather than growing
 * past the table. */
#ifndef PFIBER_MAX
#define PFIBER_MAX 48
#endif

/* Each fiber gets a C stack and, separately, the asyncify stack that
 * emscripten_fiber_swap unwinds into.
 *
 * The two must be the same size, and that is the whole point of the pair.
 * Unwinding saves every frame it passes through onto the asyncify stack, so
 * the asyncify stack has to hold the deepest chain the fiber can be in, which
 * is bounded by its C stack. Too small does not fault: the unwind writes past
 * the end of the region and the damage shows up later as something unrelated,
 * which is what a st core that hangs on some transcodes and not others looks
 * like.
 *
 * 8MB because 2MB was tried and the filter task overflowed, carrying the
 * deepest chain in the program: filter_thread -> read_frames -> ... ->
 * avcodec_open2 -> ... -> av_log.
 *
 * These are per fiber and unrelated to -sASYNCIFY_STACK_SIZE, which sizes the
 * single module-wide stack that only emscripten_sleep() uses. Nothing here
 * calls that. */
#define PFIBER_STACK_SIZE (8 * 1024 * 1024)
#define PFIBER_ASYNCIFY_STACK_SIZE (8 * 1024 * 1024)

/* g_main is the odd one out: it runs the whole of main() on the module's own
 * stack (-sSTACK_SIZE=5MB in build/ffmpeg-wasm.sh) rather than on a stack
 * allocated here, so its asyncify stack has to cover that. Same rule, and the
 * same reason 64KB and then 1MB were not enough: ffmpeg_opt_run -> transcode
 * -> scheduler_run -> sch_wait -> pthread_cond_timedwait -> the scheduler is
 * a deep chain to be unwinding. */
#define PFIBER_MAIN_ASYNCIFY_STACK_SIZE (8 * 1024 * 1024)

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
    double blocked_since_ms;      /* when it last went PF_BLOCKED, 0 when runnable */
    double running_since_ms;      /* when this fiber last gained control, see pf_maybe_preempt */
    unsigned long long wrapped_calls; /* shim entry points hit since this fiber gained control */
    const char *wrapped_where;         /* the last one, for pf_report_spin */
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

/* Values this file writes into a pthread_once_t. See __wrap_pthread_once. */
#define PF_ONCE_RUNNING 2
#define PF_ONCE_DONE 1

/* Wall-clock of the last fiber switch, and the switch and wait counts since
 * the call started. A stall is progress that stopped, not one long wait:
 * ffmpeg_sched's sch_wait() polls on a short timeout, so a pipeline that will
 * never finish shows up as thousands of short waits rather than one long one.
 *
 * The clock is deliberately the last switch and not the last time something
 * became runnable. Those differ exactly when the scheduler is thrashing, which
 * is the case worth reporting: a run where fibers keep waking each other and
 * going straight back to sleep never lets the second clock expire, so it looks
 * alive however long it goes on. Counting switches and waits alongside the
 * report says which of the two it is. */
static double g_last_switch_ms;
static unsigned long long g_switches;
static unsigned long long g_idle_waits;
/* Switches in the window the rate below is measured over, and where that
 * window started. */
static unsigned long long g_reported_switches;
static double g_rate_ms;
/* How long one fiber may hold control before a filter-graph poll hands it back.
 * The filtering thread's poll loop in fftools/ffmpeg_filter.c never blocks: it
 * drains its queue with THREAD_QUEUE_FLAG_NO_BLOCK, waiter_wait() returns
 * immediately while it is unchoked, and both av_buffersink_get_frame_flags()
 * and avfilter_graph_request_oldest() come straight back with EAGAIN. So that
 * loop has no pthread primitive the shim could block on, and on a single
 * threaded core it is a spin. The two libavfilter calls at the bottom of this
 * file are the only points in it the shim sees, and they yield here.
 *
 * The budget is wall clock per fiber rather than a count of calls because a
 * count cannot mean the same thing twice: the same iteration takes microseconds
 * to reject EAGAIN and hundreds of milliseconds to produce a frame, and a
 * global count is also reset by every switch, so how long a spinning fiber
 * actually keeps the core depends on how busy the rest of the pipeline is. A
 * wall clock budget bounds that at a fixed value instead. */
#define PF_PREEMPT_MS 5
/* Wrapped calls one fiber may make without the scheduler running again before
 * the run is called a spin and stopped.
 *
 * This counts what a yield cannot hide. Every blocking point is a wrapped
 * pthread call, so a fiber that is blocked or is yielding normally makes a
 * handful of these between scheduler entries and the counter never gets near
 * this. A fiber that keeps making them without ever blocking is looping on
 * something the shim can see but cannot preempt: the poll loop in fftools'
 * filtering thread is the known shape of that, and there the yield in
 * pf_maybe_preempt is what breaks the loop, which is exactly why nothing else
 * can observe it. Counting is not a yield and does not give the core back, so
 * this still fires on a run that a yield would have rescued.
 *
 * Two million is far above a healthy run and well under what a spin reaches
 * in a second, so the two do not overlap. */
#define PF_SPIN_CALLS 2000000
/* Passes of the contended-mutex wait loop, counted per fiber so the report
 * below can name which one is stuck and on what. See __wrap_pthread_mutex_lock
 * for why the stall reports cannot see this case on their own. */
static unsigned long long g_mutex_spins;
/* Wall clock of the last unconditional heartbeat, so a run that satisfies none
 * of the stall thresholds still says whether the scheduler is being entered.
 * See pf_report_if_stalled. */
static double g_heartbeat_ms;
/* g_main's stack bounds. Read during reset, because once a fiber has run they
 * report whichever fiber was last entered. */
static void *g_main_stack_base, *g_main_stack_limit;

/* Same epoch mechanism as pf_mutex_t, for the same reason: the block behind a
 * cond_var outlives the exec() that allocated it, because FFmpeg's cond_vars
 * are file-scope statics that are never destroyed. Which fibers are waiting
 * lives in pfiber_t.wait_on, and pfiber_reset() clears the table those live
 * in, so no waiter can carry across a call; the epoch is here to reclaim the
 * block rather than to invalidate anything. */
typedef struct {
    unsigned epoch;
} pf_cond_t;

static double pf_now_ms(void);
static void pf_count_call(const char *where);
static int pfiber_index_of(pfiber_t *f);

static pfiber_t *pfiber_at(int idx)
{
    return idx < 0 ? &g_main : &g_table[idx];
}

/* Going to sleep and waking up, in one place each, so blocked_since_ms cannot
 * be left stale: a fiber that is marked runnable but still looks blocked is
 * what a stall report has to be able to rule out. */
static void pf_block(pfiber_t *f)
{
    f->state = PF_BLOCKED;
    f->blocked_since_ms = pf_now_ms();
}

static void pf_unblock(pfiber_t *f)
{
    f->state = PF_RUNNABLE;
    f->blocked_since_ms = 0;
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
 * 5ms). A run that goes PF_STALL_REPORT_MS without a single fiber switch is
 * reported fiber by fiber with its switch and wait counts, so a stall is
 * diagnosable from a log instead of being a frozen tab, and one with no
 * deadline pending at all is a real deadlock and aborts.
 */
#define PF_STALL_REPORT_MS 5000
/* How long one fiber can sit blocked before the run is called stalled, and how
 * long before it is given up on. A pipeline that is working has some fiber
 * running or about to be woken every few milliseconds, so a fiber blocked
 * across a whole frame of work is waiting on a wakeup that is not coming. The
 * second threshold is what turns that from a frozen tab into an exec() that
 * returns -1, which is the same choice already made for a run with nothing
 * runnable and no deadline pending. */
#define PF_BLOCK_REPORT_MS 10000
#define PF_BLOCK_ABORT_MS 30000
/* Switches in one second that mean a livelock rather than a working pipeline.
 * Every blocking point is a switch, and a transcode of any length does tens of
 * thousands of them spread over seconds; thousands inside one second is the
 * scheduler handing control around without the pipeline moving. */
#define PF_SWITCH_REPORT_PER_SEC 2000
/* Passes between clock reads, which is the cost of a clock read against the
 * work skipped between them. See pf_idle_wait. */
#define PF_IDLE_CLOCK_EVERY 4096

/* Reports go to console.error, and to Module.logger as well.
 *
 * console.error alone is not enough to diagnose a hang. The runners that
 * matter here capture Module.logger, not the console: scripts/fate/run.mjs
 * keeps the last 200 logger lines and puts them in the results JSON, and
 * scripts/dump-test-page.mjs attaches to worker console output. console.error
 * to a pipe is written asynchronously in Node, so a report written while the
 * process is being SIGKILLed at a watchdog can be lost, and a hang produces its
 * reports exactly during that window. Module.logger is collected in-process, so
 * whatever the caller records survives. */
EM_JS(void, pf_report_js, (const char *s), {
  var msg = UTF8ToString(s);
  console.error(msg);
  var logger = Module['logger'];
  if (logger) logger({ type: 'stderr', message: msg });
});

/* Writes every fiber's state, what it is blocked on and for how long, so a
 * stall says who is waiting on whom instead of just hanging. */
static void pf_report_stall(double now_ms)
{
    static const char *names[] = { "free", "runnable", "blocked", "done" };
    char buf[2048];
    int n = snprintf(buf, sizeof(buf),
                     "pthread-fiber: stalled, after %llu switches and %llu "
                     "waits. fibers:",
                     g_switches, g_idle_waits);
    for (int i = -1; i < PFIBER_MAX; i++) {
        pfiber_t *f = pfiber_at(i);
        if (f->state == PF_FREE)
            continue;
        n += snprintf(buf + n, sizeof(buf) - n, " [%d %s on %p%s",
                      pfiber_index_of(f), names[f->state], f->wait_on,
                      f->has_deadline ? " timed" : "");
        if (f->state == PF_BLOCKED)
            n += snprintf(buf + n, sizeof(buf) - n, " for %.0fms",
                          now_ms - f->blocked_since_ms);
        n += snprintf(buf + n, sizeof(buf) - n, "]");
        if (n >= (int)sizeof(buf) - 96)
            break;
    }
    snprintf(buf + n, sizeof(buf) - n, "\n");
    pf_report_js(buf);
}

/* Reports the two shapes of stall there is no other way to see from here.
 * Called from every place the scheduler regains control, so it runs even when
 * the run never becomes idle: a fiber that spins without blocking would
 * otherwise keep the whole diagnostic quiet. */
static void pf_report_if_stalled(double now)
{
    /* Unconditional heartbeat, on a wall clock rather than on any of the
     * thresholds below. Every other report in this file needs something to line
     * up first: a gap between switches, a switch rate over a threshold, a fiber
     * blocked past a limit. A run that never satisfies any of those prints
     * nothing at all, which is indistinguishable from a run that never reached
     * this code. That is exactly the ambiguity the six hanging fate tests are
     * in, so this one just asks, every 5s, whether the scheduler is still
     * being entered at all and who is in it. */
    if (now - g_heartbeat_ms >= 5000) {
        g_heartbeat_ms = now;
        char msg[160];
        snprintf(msg, sizeof(msg),
                 "pthread-fiber: alive at %.0fms, %llu switches, %llu waits, "
                 "current fiber %d.\n",
                 now, g_switches, g_idle_waits, pfiber_index_of(g_current));
        pf_report_js(msg);
    }

    /* Nothing has run at all: nothing is runnable, which pf_idle_wait's abort
     * catches unless a poll is still pending. ffmpeg_sched's main fiber keeps
     * one, polling stats_period apart for the muxers to report in. */
    if (now - g_last_switch_ms > PF_STALL_REPORT_MS) {
        g_last_switch_ms = now;
        pf_report_stall(now);
        return;
    }

    /* The other shape of hang: fibers that keep waking each other and going
     * straight back to sleep. Every wait such a run makes is a short one, so
     * neither check above can see it, and it looks busy from in here. The rate
     * is what tells it apart from a pipeline doing real work. */
    if (now - g_rate_ms >= 1000) {
        unsigned long long switches = g_switches - g_reported_switches;
        double window_ms = now - g_rate_ms;
        g_rate_ms = now;
        g_reported_switches = g_switches;
        if (switches > PF_SWITCH_REPORT_PER_SEC) {
            char msg[160];
            snprintf(msg, sizeof(msg),
                     "pthread-fiber: %llu switches in %.0fms, and %llu waits.\n",
                     switches, window_ms, g_idle_waits);
            pf_report_js(msg);
            pf_report_stall(now);
            return;
        }
    }

    /* One fiber blocked for longer than any single piece of work takes means
     * something is waiting on a wakeup that is not coming, and the run is over
     * even though the polling around it looks healthy. */
    for (int i = -1; i < PFIBER_MAX; i++) {
        pfiber_t *f = pfiber_at(i);
        if (f->state != PF_BLOCKED)
            continue;
        double blocked_ms = now - f->blocked_since_ms;
        if (blocked_ms <= PF_BLOCK_REPORT_MS)
            continue;
        g_last_switch_ms = now;
        pf_report_stall(now);
        if (blocked_ms > PF_BLOCK_ABORT_MS) {
            char msg[160];
            snprintf(msg, sizeof(msg),
                     "pthread-fiber: fiber %d has been blocked for %.0fms, so "
                     "this run is not going to finish.\n",
                     pfiber_index_of(f), blocked_ms);
            pf_report_js(msg);
            abort();
        }
        return;
    }
}

static void pf_idle_wait(double wake_at_ms)
{
    double now = pf_now_ms();
    g_idle_waits++;

    /* Sample the clock in batches, not every pass. pf_now_ms is a clock_gettime,
     * which is a JavaScript import under Emscripten, so reading it on every
     * iteration turns a five millisecond wait into millions of JS calls and
     * makes a whole transcode look like a hang.
     *
     * Nothing but the sample can change anything: this fiber is the only one
     * running, so nothing else can wake, block or arm a deadline until control
     * leaves here. The checks that depend on the clock therefore belong in the
     * sampled pass, and the passes between them only wait. */
    for (unsigned long long i = 0;; i++) {
        if (i % PF_IDLE_CLOCK_EVERY != 0)
            continue;

        int woke_someone = 0;
        now = pf_now_ms();
        for (int k = -1; k < PFIBER_MAX; k++) {
            pfiber_t *f = pfiber_at(k);
            if (f->state == PF_BLOCKED && f->has_deadline) {
                if (now >= f->deadline_ms) {
                    f->wait_on = NULL;
                    f->has_deadline = 0;
                    f->woke_by_timeout = 1;
                    pf_unblock(f);
                    woke_someone = 1;
                }
            }
        }
        /* Before handing control back: ffmpeg_sched's main fiber keeps a poll
         * pending and so wakes this loop every stats_period, and an early
         * return above the checks would skip them on every pass. */
        pf_report_if_stalled(now);

        /* Hand control back as soon as a fiber is runnable again. Falling
         * through to the checks below instead aborts on the one deadline just
         * expired, since the fiber it woke is no longer a pending deadline. */
        if (woke_someone)
            return;

        int something_can_wake_us = wake_at_ms > 0;
        for (int k = -1; k < PFIBER_MAX; k++) {
            pfiber_t *f = pfiber_at(k);
            if (f->state == PF_BLOCKED && f->has_deadline)
                something_can_wake_us = 1;
        }
        if (!something_can_wake_us) {
            /* The round-robin in pfiber_reschedule only calls here after
             * finding no runnable fiber anywhere, so with no deadline left
             * either, nothing can ever run again. */
            char msg[256];
            snprintf(msg, sizeof(msg),
                     "pthread-fiber: no fiber is runnable and none has a "
                     "pending deadline, so nothing can ever run again.\n");
            pf_report_js(msg);
            abort();
        }

        if (wake_at_ms > 0 && now >= wake_at_ms)
            return;
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
    /* Epoch 0 is never handed out, so a wrapped counter cannot make a mutex
     * left over from 2^32 calls ago look like the current one. */
    if (++g_epoch == 0)
        g_epoch = 1;

    /* The old g_main.asyncify_stack is reachable through the memset below, so
     * free it first. Without this every exec() leaks a megabyte, and an
     * application that runs ffmpeg thousands of times runs the heap out. */
    free(g_main.asyncify_stack);
    memset(&g_main, 0, sizeof(g_main));
    g_main.state = PF_RUNNABLE;
    /* See g_main_stack_base: this is the one moment they still describe it. */
    g_main_stack_base = (void *)emscripten_stack_get_base();
    g_main_stack_limit = (void *)emscripten_stack_get_end();
    g_main.asyncify_stack = malloc(PFIBER_MAIN_ASYNCIFY_STACK_SIZE);
    g_main.asyncify_stack_size = PFIBER_MAIN_ASYNCIFY_STACK_SIZE;
    if (!g_main.asyncify_stack) {
        pf_report_js("pthread-fiber: out of memory for the main fiber's "
                     "asyncify stack\n");
        abort();
    }
    emscripten_fiber_init_from_current_context(&g_main.ctx, g_main.asyncify_stack,
                                                g_main.asyncify_stack_size);
    g_current = &g_main;
    g_last_switch_ms = pf_now_ms();
    g_switches = 0;
    g_idle_waits = 0;
    g_reported_switches = 0;
    g_rate_ms = g_last_switch_ms;
    g_mutex_spins = 0;
    g_heartbeat_ms = g_last_switch_ms;
    g_main.running_since_ms = g_last_switch_ms;
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
            pf_unblock(f);
        }
    }
}

/* Bounds check on the asyncify stack, which has none of its own.
 *
 * A fiber's C frames are unwound onto this buffer when it is switched away
 * from, and emscripten_fiber_swap does not check it: the unwind walks the stack
 * pointer down and writes each frame without ever comparing it against the end
 * of the buffer. -sSTACK_OVERFLOW_CHECK does not cover it either, that one
 * watches the C stack, which is a different allocation. So an unwind deeper than
 * the buffer writes past it into whatever the heap put next, and the run then
 * misbehaves somewhere unrelated to the cause: a hang, or a crash in code that
 * has nothing to do with it. This is the only place both ends of the buffer are
 * known, so the check goes here.
 *
 * Called after a switch has completed, so an overflow it reports has already
 * happened. It is a report, not prevention: the distance past the end is what
 * says whether the buffer is too small, which is the number needed to size it.
 */
static void pf_check_asyncify_stack(pfiber_t *f)
{
    char *low = f->asyncify_stack;
    char *high = low + f->asyncify_stack_size;
    char *sp = (char *)f->ctx.asyncify_data.stack_ptr;

    if (sp >= low && sp <= high)
        return;

    char msg[256];
    snprintf(msg, sizeof(msg),
             "pthread-fiber: fiber %d unwound outside its %zu byte asyncify "
             "stack, stack pointer %p against buffer %p..%p.\n",
             pfiber_index_of(f), f->asyncify_stack_size,
             (void *)sp, (void *)low, (void *)high);
    pf_report_js(msg);
    abort();
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
        pf_report_if_stalled(pf_now_ms());

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
                pf_unblock(f);
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
            g_switches++;
            g_last_switch_ms = pf_now_ms();
            pfiber_t *prev = g_current;
            g_current = next;
            /* Recorded here because this is the moment next gains control, in
             * both directions of a switch. See pf_maybe_preempt. */
            g_current->running_since_ms = g_last_switch_ms;
            g_current->wrapped_calls = 0;
            emscripten_fiber_swap(&prev->ctx, &next->ctx);
            /* Only the way back needs fixing up, and only for g_main: it runs
             * on the module stack, which
             * emscripten_fiber_init_from_current_context does not record in
             * g_main.ctx, so restoring from there leaves a fiber's bounds in
             * force and bind.js's stackRestore aborts. */
            if (prev == &g_main)
                emscripten_stack_set_limits(g_main_stack_base,
                                            g_main_stack_limit);
            else
                emscripten_stack_set_limits(prev->ctx.stack_base,
                                            prev->ctx.stack_limit);
            /* Control is back on prev, so prev's unwind has just finished and
             * its asyncify stack pointer is where the unwind stopped. */
            pf_check_asyncify_stack(prev);
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

    /* Say which fiber started and which returned, so a task that never gets
     * picked up is distinguishable from one that starts and never comes back.
     * pthread_create in this shim does not swap to the new fiber, it only
     * marks it PF_RUNNABLE, so a fiber's first line runs some time after the
     * pthread_create that made it, and the fate logs alone cannot show whether
     * that ever happened. pf_report_js is the same console.error plus logger
     * route, and run.mjs keeps anything matching "pthread-fiber:". */
    {
        char msg[128];
        snprintf(msg, sizeof(msg), "pthread-fiber: fiber %d started.\n",
                 pfiber_index_of(f));
        pf_report_js(msg);
    }

    f->retval = f->start_routine(f->arg);
    f->state = PF_DONE;
    {
        char msg[128];
        snprintf(msg, sizeof(msg), "pthread-fiber: fiber %d returned %p.\n",
                 pfiber_index_of(f), f->retval);
        pf_report_js(msg);
    }
    if (f->join_waiter) {
        pf_unblock(f->join_waiter);
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
    if (!f) {
        char msg[160];
        snprintf(msg, sizeof(msg),
                 "pthread-fiber: all %d fibers are in use, so this thread "
                 "cannot be created.\n",
                 PFIBER_MAX);
        pf_report_js(msg);
        return EAGAIN;
    }

    char *c_stack = malloc(PFIBER_STACK_SIZE);
    char *asyncify_stack = malloc(PFIBER_ASYNCIFY_STACK_SIZE);
    if (!c_stack || !asyncify_stack) {
        char msg[160];
        snprintf(msg, sizeof(msg),
                 "pthread-fiber: out of memory for a fiber's %d byte stack.\n",
                 PFIBER_STACK_SIZE);
        pf_report_js(msg);
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
    pf_block(g_current);
    while (f->state != PF_DONE)
        pfiber_reschedule();
    pf_unblock(g_current);

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
    pfiber_ensure_main();

    /* A fiber that arrives while the initializer is still running has to wait
     * for it, not run the routine again and not carry on either. Real
     * pthread_once blocks, and the routines behind it (ff_h264_decode_init_vlc
     * and friends) fill in tables of pointers that the first fiber is still
     * writing; letting a second fiber through hands it half-built state, and
     * with frame threaded decoding there is more than one fiber in the H.264
     * decoder at a time.
     *
     * "Running" is this file's own marker so it cannot collide with the 0 and 1
     * a real pthread_once uses. Nothing else looks at *once_control. */
    if (*once_control == PF_ONCE_RUNNING) {
        g_current->wait_on = once_control;
        pf_block(g_current);
        while (*once_control == PF_ONCE_RUNNING)
            pfiber_reschedule();
    }

    if (*once_control != PF_ONCE_DONE) {
        *once_control = PF_ONCE_RUNNING;
        init_routine();
        *once_control = PF_ONCE_DONE;
        pf_wake_waiters_on(once_control);
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
        if (!*slot) {
            /* No error to hand back: FFmpeg ignores pthread_mutex_lock's
             * return value, and pthread_cond_wait cannot pass one on. */
            pf_report_js("pthread-fiber: out of memory for mutex state\n");
            abort();
        }
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
    pf_count_call("pthread_mutex_lock");
    pf_mutex_t *m = pf_mutex_ensure(mutex);
    if (m->owner == g_current) {
        /* A non-recursive lock taken twice by the same fiber can never be
         * satisfied: the wait below would block on a lock this fiber holds,
         * and no other fiber can release it. av_log() holds a static mutex,
         * so this is where a re-entrant log call would otherwise hang the
         * core with nothing to show for it. */
        char msg[256];
        snprintf(msg, sizeof(msg),
                 "pthread-fiber: fiber %d locked a mutex it already holds "
                 "(%p). The lock is not recursive, so this can never be "
                 "satisfied.\n",
                 pfiber_index_of(g_current), (void *)mutex);
        pf_report_js(msg);
        abort();
    }
    if (m->owner != NULL)
    while (m->owner != NULL) {
        g_current->wait_on = (void *)mutex;
        pf_block(g_current);
        pfiber_reschedule();
        g_current->wait_on = NULL;
        pf_unblock(g_current);
        /* This loop hides a hang from the stall reports. Each pass goes through
         * pf_block, which restarts blocked_since_ms, so a fiber that comes back
         * here over and over looks like it is making progress: it is never
         * blocked for PF_BLOCK_REPORT_MS, and every pass counts as a switch, so
         * neither the long-block nor the switch-rate report fires either. A
         * mutex held by a fiber that will never release it looks exactly like a
         * busy pipeline from inside the scheduler. Count the passes so that
         * case is visible. */
        if (++g_mutex_spins % 1000000 == 0) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                     "pthread-fiber: fiber %d has spun on mutex %p, held by "
                     "fiber %d, for %llu passes.\n",
                     pfiber_index_of(g_current), (void *)mutex,
                     m->owner ? pfiber_index_of(m->owner) : -1,
                     (unsigned long long)g_mutex_spins);
            pf_report_js(msg);
            pf_report_stall(pf_now_ms());
        }
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
    if (!*slot || (*slot)->epoch != g_epoch) {
        free(*slot);
        *slot = calloc(1, sizeof(pf_cond_t));
        if (*slot)
            (*slot)->epoch = g_epoch;
    }
    return *slot;
}

int __wrap_pthread_cond_init(pthread_cond_t *cond, const pthread_condattr_t *attr)
{
    (void)attr;
    pf_cond_t **slot = (pf_cond_t **)(void *)cond;
    free(*slot);
    *slot = calloc(1, sizeof(pf_cond_t));
    if (*slot)
        (*slot)->epoch = g_epoch;
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
    pf_block(g_current);
    while (g_current->wait_on == cond_ptr)
        pfiber_reschedule();

    __wrap_pthread_mutex_lock(mutex);
    return 0;
}

int __wrap_pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex,
                                   const struct timespec *abstime)
{
    pfiber_ensure_main();
    pf_count_call("pthread_cond_timedwait");
    pf_cond_ensure(cond);
    void *cond_ptr = (void *)cond;
    double deadline = (double)abstime->tv_sec * 1000.0 + (double)abstime->tv_nsec / 1e6;

    __wrap_pthread_mutex_unlock(mutex);
    g_current->wait_on = cond_ptr;
    g_current->has_deadline = 1;
    g_current->deadline_ms = deadline;
    g_current->woke_by_timeout = 0;
    pf_block(g_current);
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

struct AVFilterGraph;
struct AVFilterContext;
struct AVFrame;

/* Hand control back if this fiber has held it for longer than PF_PREEMPT_MS.
 *
 * Only safe from a fiber that is not blocked: pfiber_reschedule() returns
 * immediately when the caller is PF_RUNNABLE and nothing else is, which is
 * exactly a voluntary yield. */
static void pf_maybe_preempt(void)
{
    double now = pf_now_ms();
    if (now - g_current->running_since_ms < PF_PREEMPT_MS)
        return;
    /* Cleared before yielding as well as on the way back, so a fiber that
     * yields at an idle scheduler and immediately returns does not re-check
     * against a timestamp it can no longer make progress against. */
    g_current->running_since_ms = now;
    pfiber_reschedule();
}

/* Called on entry to every shim entry point a fiber can loop through, counting
 * them against PF_SPIN_CALLS. Deliberately does not yield: the point is to
 * catch the loop that yielding hides. */
static void pf_count_call(const char *where)
{
    pfiber_t *f = g_current;
    f->wrapped_where = where;
    if (++f->wrapped_calls < PF_SPIN_CALLS)
        return;

    char msg[320];
    snprintf(msg, sizeof(msg),
             "pthread-fiber: fiber %d made %d wrapped calls without the "
             "scheduler running, most recently %s, after %llu switches. It is "
             "looping on something this shim cannot preempt.\n",
             pfiber_index_of(f), PF_SPIN_CALLS, where,
             (unsigned long long)g_switches);
    pf_report_js(msg);
    pf_report_stall(pf_now_ms());
    abort();
}

/* fftools' filtering thread polls for frames rather than blocking for them, so
 * these two calls are the only points in its poll loop the shim gets to see.
 * Both happen at least once per pass: fg_output_step() drains every output with
 * av_buffersink_get_frame_flags(AV_BUFFERSINK_FLAG_NO_REQUEST), and read_frames()
 * then pulls with avfilter_graph_request_oldest(). The yield goes before the
 * real call so a fiber that spends a whole budget inside one of them gives the
 * core back on the following pass, not only once the frame has come out. */
int __real_avfilter_graph_request_oldest(struct AVFilterGraph *graph);
int __wrap_avfilter_graph_request_oldest(struct AVFilterGraph *graph)
{
    pfiber_ensure_main();
    pf_count_call("avfilter_graph_request_oldest");
    pf_maybe_preempt();
    return __real_avfilter_graph_request_oldest(graph);
}

/* Counted for PF_SPIN_CALLS but deliberately not a yield point. A graph whose
 * source changes pixel format partway through reconfigures itself, so a loop
 * that reconfigures without settling shows up here and nowhere else: fftools
 * calls this from configure_filtergraph(), and nothing in that path touches a
 * pthread primitive the shim wraps. */
int __real_avfilter_graph_config(struct AVFilterGraph *graph, void *log_ctx);
int __wrap_avfilter_graph_config(struct AVFilterGraph *graph, void *log_ctx)
{
    pfiber_ensure_main();
    pf_count_call("avfilter_graph_config");
    return __real_avfilter_graph_config(graph, log_ctx);
}

int __real_av_buffersink_get_frame_flags(struct AVFilterContext *filter,
                                          struct AVFrame *frame, int flags);
int __wrap_av_buffersink_get_frame_flags(struct AVFilterContext *filter,
                                          struct AVFrame *frame, int flags)
{
    pfiber_ensure_main();
    pf_count_call("av_buffersink_get_frame_flags");
    pf_maybe_preempt();
    return __real_av_buffersink_get_frame_flags(filter, frame, flags);
}

int __wrap_usleep(unsigned usec)
{
    pfiber_ensure_main();
    pf_count_call("usleep");
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
