import './style.css';
import { startGame } from './game/game';

const dispose = startGame(document.querySelector<HTMLElement>('#app')!);
if (import.meta.hot) import.meta.hot.dispose(dispose);
