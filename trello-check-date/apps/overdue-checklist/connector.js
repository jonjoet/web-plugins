import { TRELLO_APP_KEY } from 'virtual:trello-config';
import { APP_NAME } from '../../shared/auth.js';
import { openResultsModal } from '../../shared/navigation.js';
import navyIcon from './icons/navy.svg';
import whiteIcon from './icons/white.svg';

export function capabilities(base = import.meta.env.BASE_URL) {
  return {
    'board-buttons': () => [{
      // Trello's keys name the board background, so use the contrasting ink.
      icon: { dark: whiteIcon, light: navyIcon },
      text: 'Overdue items',
      callback: t => openResultsModal(t, {
        fullscreen: true,
        url: `${base}apps/overdue-checklist/view.html`,
        title: 'Overdue checklist items',
      }),
    }],
  };
}

if (window.TrelloPowerUp) {
  window.TrelloPowerUp.initialize(capabilities(), { appKey: TRELLO_APP_KEY, appName: APP_NAME });
} else {
  document.querySelector('#connector-status').textContent = 'The Trello SDK could not load. Check your connection and reopen the Power-Up.';
}
