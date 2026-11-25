import { createRoot } from 'react-dom/client';
import { DownloadPage } from './views/download/download-page.tsx';
import './tokens.css';
import './shell/base.css';
import './shell/secondary-button.css';

const root = document.getElementById('root');
if (root === null) throw new Error('下载页缺少根元素。');
createRoot(root).render(<DownloadPage />);
