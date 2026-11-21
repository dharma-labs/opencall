import { createRoot } from 'react-dom/client';
import App from './App';
import { initPlatform } from './modules/platform/PwaManager';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container is missing from index.html.');

// Registers the service worker and listens for install signals. It is a no-op
// inside the Electron, Tauri and Capacitor shells.
initPlatform();

createRoot(container).render(<App />);
