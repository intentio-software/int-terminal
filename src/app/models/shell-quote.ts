/**
 * A path, safe to type at a shell prompt.
 *
 * Dropping a file into a terminal has always meant "put its path where my
 * cursor is", and a path is not a word: it can hold spaces, quotes, brackets
 * and anything else the filesystem allows. Handing one over unquoted turns
 * "My Photos/shot 1.png" into three arguments, which is how a drop ends up
 * doing nothing or, worse, something else.
 *
 * Single quotes rather than backslashes. Inside them every character is
 * literal in sh, bash, zsh and fish alike, so there is one rule instead of one
 * per shell. A single quote is the sole exception, and it is closed, escaped
 * and reopened - the incantation that looks wrong and is correct.
 */
export function quoteForShell(path: string): string {
  // A path of ordinary characters needs no quoting, and not quoting it keeps
  // what appears at the prompt readable.
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) {
    return path;
  }
  return `'${path.split("'").join(`'\\''`)}'`;
}

/** Several dropped files become several arguments. */
export function quotePaths(paths: readonly string[]): string {
  return paths.map(quoteForShell).join(" ");
}
