import type { Account } from '../types';

interface Props {
  accounts: Account[];
  selectedId?: string;
  onSelect: (account: Account) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function SavedAccounts({ accounts, selectedId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="saved-accounts">
      <div className="saved-header">
        <h2>Saved accounts</h2>
        <button className="secondary" onClick={onNew}>+ New</button>
      </div>
      {accounts.length === 0 ? (
        <p className="empty">No saved accounts yet.</p>
      ) : (
        <ul className="account-list">
          {accounts.map(account => (
            <li
              key={account.id}
              className={`account-item ${account.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(account)}
            >
              <div className="account-name">{account.companyName}</div>
              <div className="account-date">{new Date(account.updatedAt).toLocaleDateString()}</div>
              <button
                className="delete-btn"
                onClick={e => {
                  e.stopPropagation();
                  if (confirm('Delete this account?')) onDelete(account.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
