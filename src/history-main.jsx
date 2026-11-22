import { render } from 'solid-js/web';
import './styles/tokens.css';
import './styles/history.css';
import './styles/command-search.css';
import './styles/motion.css';
import { HistoryApp } from './pages/HistoryApp.jsx';

render(() => <HistoryApp />, document.getElementById('root'));
