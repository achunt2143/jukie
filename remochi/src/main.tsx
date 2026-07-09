import React from 'react';
import ReactDOM from 'react-dom/client';
import 'remochi/css';
import { ThemeWrapper } from 'remochi';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeWrapper>
      <App />
    </ThemeWrapper>
  </React.StrictMode>,
);
