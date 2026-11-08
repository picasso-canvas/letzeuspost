/** The smallest template: it proves the worker can render the package's built output (#64). The real ones come with #72. */
export function EmailCheck({ name }: { name: string }) {
  return (
    <html lang="en">
      <body>
        <p>{name}</p>
      </body>
    </html>
  );
}
