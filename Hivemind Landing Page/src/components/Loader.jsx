import { Html, useProgress } from "@react-three/drei";

const CanvasLoader = () => {
  const { progress } = useProgress();
  return (
    <Html
      as='div'
      center
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0,0,0,0.8)",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 1000
      }}
    >
      <div 
        className='canvas-loader'
        style={{
          width: 50,
          height: 50,
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #3498db',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}
      />
      <p
        style={{
          fontSize: 14,
          color: "#F1F1F1",
          fontWeight: 800,
          marginTop: 20,
          textAlign: 'center'
        }}
      >
        Loading 3D Model
        <br />
        {progress.toFixed(2)}%
      </p>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </Html>
  );
};

export default CanvasLoader;