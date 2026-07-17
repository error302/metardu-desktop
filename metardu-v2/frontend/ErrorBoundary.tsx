import React from "react";
interface S { hasError: boolean; error: Error | null; }
export class ErrorBoundary extends React.Component<{children: React.ReactNode}, S> {
  constructor(p: {children: React.ReactNode}) { super(p); this.state = {hasError: false, error: null}; }
  static getDerivedStateFromError(e: Error): S { return {hasError: true, error: e}; }
  componentDidCatch(e: Error): void { console.error("[ErrorBoundary]", e); }
  render(): React.ReactNode {
    if (this.state.hasError) return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0a",color:"#e5e5e5",fontFamily:"monospace",gap:"16px",padding:"32px",textAlign:"center"}}><div style={{fontSize:"48px",color:"#ef4444"}}>⚠</div><h1 style={{fontSize:"18px",color:"#ef4444"}}>Something went wrong</h1><pre style={{fontSize:"10px",color:"#525252",background:"#111",border:"1px solid #262626",padding:"12px",maxWidth:"600px",overflow:"auto"}}>{this.state.error?.message ?? "Unknown error"}</pre><button onClick={() => this.setState({hasError:false,error:null})} style={{background:"#2dd4bf",color:"#0a0a0a",border:"none",padding:"8px 24px",fontFamily:"monospace",cursor:"pointer"}}>Try Again</button></div>;
    return this.props.children;
  }
}
