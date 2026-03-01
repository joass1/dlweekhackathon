import React, { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Preload, useGLTF } from "@react-three/drei";
import CanvasLoader from "./Loader";

const BrainModel = ({ isMobile }) => {
  const brain = useGLTF("public/brain_gltf/scene.gltf");
  
  return (
    <mesh>
      <hemisphereLight intensity={10} groundColor='black' />
      <spotLight
        position={[-20, 50, 10]}
        angle={0.12}
        penumbra={1}
        intensity={1}
        castShadow
        shadow-mapSize={1024}
      />
      <pointLight intensity={1} />
      <primitive
        object={brain.scene}
        scale={isMobile ? 0.2 : 0.4}
        position={isMobile ? [0, -1, -2.2] : [0, -1, -1.5]}
        rotation={[0, Math.PI / 4, 0]}
      />
    </mesh>
  );
};

const BrainCanvas = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 500px)");
    
    setIsMobile(mediaQuery.matches);
    
    const handleMediaQueryChange = (event) => {
      setIsMobile(event.matches);
    };
    
    mediaQuery.addEventListener("change", handleMediaQueryChange);
    
    return () => {
      mediaQuery.removeEventListener("change", handleMediaQueryChange);
    };
  }, []);

  return (
    <div className="w-full h-80 md:h-96 lg:h-[500px] relative touch-none select-none">
      <Canvas
        frameloop='demand'
        shadows
        dpr={[1, 2]}
        camera={{ 
          position: [0, 1, 5], 
          fov: 25 
        }}
        gl={{ preserveDrawingBuffer: true }}
        style={{ 
          width: '100%', 
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          touchAction: 'none'
        }}
      >
        <Suspense fallback={<CanvasLoader />}>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            maxPolarAngle={Math.PI / 2}
            minPolarAngle={-Math.PI / 2}
            rotateSpeed={0.5}
          />
          <BrainModel isMobile={isMobile} />
        </Suspense>
        <Preload all />
      </Canvas>
    </div>
  );
};

export default BrainCanvas;