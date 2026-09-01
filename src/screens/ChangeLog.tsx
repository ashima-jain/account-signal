import { useAccount } from '../useAccount';
import { Empty } from '../components/ui';

export default function ChangeLog() {
  const { aggregate } = useAccount();
  const events = [...aggregate.events].reverse();

  return (
    <div className="card">
      <h2>Change log</h2>
      <p className="dim">
        What changed, and why. Demotions are recorded with their reason, so a downgraded fact can
        always be explained.
      </p>
      {events.length === 0 ? (
        <Empty>Nothing has happened yet.</Empty>
      ) : (
        <div className="timeline" style={{ marginTop: 14 }}>
          {events.map((event) => (
            <div className="event" key={event.id}>
              <div className="row">
                <span className="badge">{event.type.replace(/_/g, ' ')}</span>
                <span className="dim">{new Date(event.at).toLocaleString()}</span>
              </div>
              <div>{event.summary}</div>
              {event.reason ? <div className="muted">{event.reason}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
