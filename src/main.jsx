import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { store } from './app/store';
import App from './App';
import './styles.css';
import './workspace-design.css';
import './modern-ui.css';

const router = createBrowserRouter(
    [{ path: '*', element: <App /> }],
    { basename: import.meta.env.BASE_URL },
);

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <Provider store={store}>
            <RouterProvider router={router} />
        </Provider>
    </React.StrictMode>,
);
