import { Link, Route, Routes } from 'react-router-dom';
import CommandCenter from './screens/CommandCenter';
import AccountLayout from './screens/AccountLayout';
import EvidenceLedger from './screens/EvidenceLedger';
import Thesis from './screens/Thesis';
import ChangeLog from './screens/ChangeLog';
import ComingSoon from './screens/ComingSoon';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Account Signal
        </Link>
        <span className="brand-tag">What should I do next on this account?</span>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/accounts/:accountId" element={<AccountLayout />}>
            <Route index element={<Thesis />} />
            <Route path="evidence" element={<EvidenceLedger />} />
            <Route
              path="stakeholders"
              element={
                <ComingSoon
                  title="Stakeholders and the Champion Test"
                  detail="Buyer-role map, posture versus computed champion tier, and the eight-signal champion test with required evidence."
                />
              }
            />
            <Route
              path="actions"
              element={
                <ComingSoon
                  title="Actions"
                  detail="A single action list that feeds both the 30-day plan and Next Best Action, ranked by which unknowns each action resolves."
                />
              }
            />
            <Route path="changelog" element={<ChangeLog />} />
          </Route>
          <Route path="*" element={<p className="empty">That page does not exist.</p>} />
        </Routes>
      </main>
    </div>
  );
}
