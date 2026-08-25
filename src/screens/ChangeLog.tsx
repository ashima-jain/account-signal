import { EVENTS_CAP } from '../domain/types';
import { useAccount } from './AccountLayout';
import { EmptyState } from '../components/Feedback';
import { formatDate } from '../lib/format';

const LABELS: Record<string, string> = {
  account_created: 'Account created',
  account_updated: 'Account updated',
  evidence_added: 'Evidence added',
  evidence_removed: 'Evidence removed',
  claim_added: 'Claim added',
  claim_status_changed: 'Claim status changed',
  claim_superseded: 'Claim superseded',
  wedge_added: 'Wedge added',
  wedge_disqualified: 'Wedge disqualified',
  stakeholder_added: 'Stakeholder added',
  stakeholder_updated: 'Stakeholder updated',
  posture_changed: 'Posture changed',
  signal_recorded: 'Champion signal recorded',
  champion_tier_changed: 'Champion tier changed',
  action_added: 'Action added',
  action_completed: 'Action completed',
  thesis_regenerated: 'Thesis regenerated',
};

export default function ChangeLog() {
  const { aggregate } = useAccount();
  const events = [...aggregate.events].reverse();

  return (
    <div className="card">
      <div className="card-head">
        <h2>Change log</h2>
        <span className="subtle">Newest first · last {EVENTS_CAP} entries kept</span>
      </div>

      <p className="subtle">
        What changed, when, and why. This is how you tell the difference between an account that is
        progressing and one where only the story has changed.
      </p>

      {events.length === 0 ? (
        <EmptyState title="Nothing has happened yet." />
      ) : (
        <ol className="event-list">
          {events.map((event) => (
            <li key={event.id}>
              <div className="event-head">
                <strong>{LABELS[event.type] ?? event.type}</strong>
                <span className="subtle">{formatDate(event.at)}</span>
              </div>
              <p>{event.summary}</p>
              {event.reason && <p className="event-reason">Why: {event.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
