/**
 * The stage CLIs write their payloads to files, so anything reaching a stream here is for a
 * human watching the run. `no-console` is an error in this repo's lint config and silencing
 * it per-file would scatter the decision; this is the one place that writes to a stream.
 */
const write = (stream: NodeJS.WriteStream, parts: Array<unknown>): void => {
  stream.write(`${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
};

export const logger = {
  info: (...parts: Array<unknown>): void => write(process.stdout, parts),
  warn: (...parts: Array<unknown>): void => write(process.stderr, parts),
  error: (...parts: Array<unknown>): void => write(process.stderr, parts),
};
