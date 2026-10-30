import wordmark from '../assets/wordmark.svg?raw';

/** VelarisKasa yazı logosu; yazı rengi bulunduğu yerin metin rengini alır. */
export function Wordmark({ height = 28, className = '' }) {
  return <span className={`wordmark ${className}`} style={{ height }} role="img" aria-label="VelarisKasa" dangerouslySetInnerHTML={{ __html: wordmark }} />;
}
