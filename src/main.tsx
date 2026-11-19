import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { CustomerProvider } from './context/CustomerContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <CustomerProvider>
        <App />
      </CustomerProvider>
    </ErrorBoundary>
  </StrictMode>,
);
