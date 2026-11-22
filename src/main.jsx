import { render } from 'solid-js/web';
import './styles/tokens.css';
import './styles/player-layout.css';
import './styles/player-content.css';
import './styles/player-chrome.css';
import './styles/player-overlays.css';
import './styles/motion.css';
import { PlayerApp } from './pages/PlayerApp.jsx';

render(() => <PlayerApp />, document.getElementById('root'));
