import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AlphaBanner } from './components/AlphaBanner';
import { ConsentBanner } from './components/ConsentBanner';
import { FeedbackWidget } from './components/FeedbackWidget';
import { PolishRuntime } from './components/PolishRuntime';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
      <PolishRuntime />
      <AlphaBanner />
      <FeedbackWidget />
      <ConsentBanner />
    </AppErrorBoundary>
  </StrictMode>
);
