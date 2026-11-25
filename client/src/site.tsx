import { createRoot } from 'react-dom/client';
import { SitePage } from './views/site/site-page.tsx';
import './tokens.css';
import './views/site/site.css';

const root = document.getElementById('root');
if (root === null) throw new Error('官网缺少根元素。');
createRoot(root).render(<SitePage />);
