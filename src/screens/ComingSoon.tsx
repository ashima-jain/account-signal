/**
 * Explicit placeholder. A tab that silently renders nothing reads as a bug, and
 * naming what is missing is more useful than hiding it.
 */
export default function ComingSoon({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="subtle">Not built yet.</p>
      <p>{detail}</p>
    </div>
  );
}
