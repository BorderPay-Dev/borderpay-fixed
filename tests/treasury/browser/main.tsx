import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import '../../../styles/globals.css';
import { OperatorBridgeReadOnlyApp } from '../../../components/business/OperatorBridgeReadOnlyApp';
createRoot(document.getElementById('root')!).render(<><OperatorBridgeReadOnlyApp onLogout={() => { (window as any).signedOut = true; }}/><Toaster/></>);
