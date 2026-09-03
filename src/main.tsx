import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './styles.css';
import CommandCenter from './screens/CommandCenter';
import AccountLayout from './screens/AccountLayout';
import Thesis from './screens/Thesis';
import EvidenceLedger from './screens/EvidenceLedger';
import Stakeholders from './screens/Stakeholders';
import Wedges from './screens/Wedges';
import Actions from './screens/Actions';
import ChangeLog from './screens/ChangeLog';
import Gate from './screens/Gate';

const router = createBrowserRouter([
  { path: '/', element: <CommandCenter /> },
  {
    path: '/accounts/:id',
    element: <AccountLayout />,
    children: [
      { index: true, element: <Thesis /> },
      { path: 'evidence', element: <EvidenceLedger /> },
      { path: 'stakeholders', element: <Stakeholders /> },
      { path: 'wedges', element: <Wedges /> },
      { path: 'actions', element: <Actions /> },
      { path: 'log', element: <ChangeLog /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gate>
      <RouterProvider router={router} />
    </Gate>
  </StrictMode>
);
