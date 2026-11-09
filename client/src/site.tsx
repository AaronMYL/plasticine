// Cyber Hunter 官网（11-09 设计稿「Cyber Hunter 官网设计稿」）：独立入口，不加载主应用、登录状态或 Service Worker。
// 中继在 cyberhunter.top/ 发这一页（资源和下载页一样在 /download/ui/ 下）。演示全是写死的数据，不调 AI。
import { createRoot } from 'react-dom/client';
import { SitePage } from './views/site/site-page.tsx';
import './tokens.css';
import './views/site/site.css';

const root = document.getElementById('root');
if (root === null) throw new Error('官网缺少根元素。');
createRoot(root).render(<SitePage />);
