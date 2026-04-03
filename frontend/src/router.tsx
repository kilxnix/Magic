import { createBrowserRouter } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { DeckViewerPage } from './pages/DeckViewerPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { PlayPage } from './pages/PlayPage';
import { ShelectorPage } from './pages/ShelectorPage';

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/generate', element: <GeneratorPage /> },
  { path: '/deck/:id', element: <DeckViewerPage /> },
  { path: '/optimizer', element: <OptimizerPage /> },
  { path: '/play', element: <PlayPage /> },
  { path: '/shelector', element: <ShelectorPage /> },
]);
