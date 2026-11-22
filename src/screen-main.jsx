import { render } from 'solid-js/web';
import './styles/tokens.css';
import './styles/screen.css';
import './styles/command-search.css';
import './styles/motion.css';
import { ScreenApp } from './pages/ScreenApp.jsx';

render(() => <ScreenApp />, document.getElementById('root'));
