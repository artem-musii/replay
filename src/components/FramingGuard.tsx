export function FramingGuard() {
  const directUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  return (
    <main className="frame-guard" id="main-content">
      <p className="section-kicker">Private local workspace</p>
      <h1>Open REPLAY directly</h1>
      <p>
        REPLAY does not run inside another page. Open the workspace in a top-level tab so its human
        review controls cannot be visually obscured.
      </p>
      <a className="button button--primary" href={directUrl} target="_top">
        Open REPLAY
      </a>
    </main>
  );
}
