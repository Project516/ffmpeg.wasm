// Minimal shell-like tokenizer for the CMD argument strings found in
// FFmpeg's .mak files: splits on whitespace, honoring single and double
// quotes so filter graphs like -vf "scale=iw/2:ih/2" survive as one token.
export function tokenize(args) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += c;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
