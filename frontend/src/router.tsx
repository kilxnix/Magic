import { createBrowserRouter } from 'react-router-dom';
import { GeneratorPage } from './pages/GeneratorPage';
import { DeckViewerPage } from './pages/DeckViewerPage';
import { OptimizerPage } from './pages/OptimizerPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <GeneratorPage />,
  },
  {
    path: '/deck/:id',
    element: <DeckViewerPage />,
  },
  {
    path: '/optimizer',
    element: <OptimizerPage />,
  },
]);
