declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.css';

declare module '*?url' {
  const url: string;
  export default url;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
