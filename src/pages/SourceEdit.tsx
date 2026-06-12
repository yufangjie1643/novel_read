import { useParams } from 'react-router-dom';

export default function SourceEdit() {
  const { sourceUrl } = useParams();
  return (
    <div style={{ padding: 24 }}>
      <h2>Source Edit (placeholder)</h2>
      <p>URL: {sourceUrl}</p>
      <p>Full edit UI + live test panel is post-v1.</p>
    </div>
  );
}
