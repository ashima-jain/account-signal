import { Link, Route, Routes } from 'react-router-dom';
import CommandCenter from './screens/CommandCenter';
import AccountLayout from './screens/AccountLayout';
import EvidenceLedger from './screens/EvidenceLedger';
import Thesis from './screens/Thesis';
import Stakeholders from './screens/Stakeholders';
import Wedges from './screens/Wedges';
import Actions from './screens/Actions';
import ChangeLog from './screens/ChangeLog';

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
            <Route path="stakeholders" element={<Stakeholders />} />
            <Route path="wedges" element={<Wedges />} />
            <Route path="actions" element={<Actions />} />
            <Route path="changelog" element={<ChangeLog />} />
          </Route>
          <Route path="*" element={<p className="empty">That page does not exist.</p>} />
        </Routes>
      </main>
    </div>
  );
}
