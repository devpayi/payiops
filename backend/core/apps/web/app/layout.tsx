import type { Metadata } from 'next';
import './style.css';
export const metadata:Metadata={title:'MONA · จัดซื้อและบัญชี',description:'ระบบจัดซื้อ การตลาด และการเงินของ MONA',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body>{children}</body></html>;}
