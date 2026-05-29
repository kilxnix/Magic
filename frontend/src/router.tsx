import { createBrowserRouter } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { DeckViewerPage } from './pages/DeckViewerPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { PlayPage } from './pages/PlayPage';
import { ShelectorPage } from './pages/ShelectorPage';
import { MultiplayerPage } from './pages/MultiplayerPage';
import { EventCenterPage } from './pages/EventCenterPage';
import { AdminConsolePage } from './pages/AdminConsolePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { TermsPage } from './pages/TermsPage';
import { ContactPage } from './pages/ContactPage';
import { HowTrainingWorksPage } from './pages/HowTrainingWorksPage';

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/generate', element: <GeneratorPage /> },
  { path: '/deck/:id', element: <DeckViewerPage /> },
  { path: '/optimizer', element: <OptimizerPage /> },
  { path: '/play', element: <PlayPage /> },
  { path: '/multiplayer', element: <MultiplayerPage /> },
  { path: '/multiplayer/:roomId', element: <MultiplayerPage /> },
  { path: '/events', element: <EventCenterPage /> },
  { path: '/events/:eventId', element: <EventCenterPage /> },
  { path: '/admin', element: <AdminConsolePage /> },
  { path: '/shelector', element: <ShelectorPage /> },
  { path: '/how-training-works', element: <HowTrainingWorksPage /> },
  { path: '/how-it-works', element: <HowTrainingWorksPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/contact', element: <ContactPage /> },
  { path: '/about', element: <ContactPage /> },
]);
