import './index.css'
import { Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Hero from './components/Hero';
import Benefits from './components/Benifits';
import Collaboration from './components/Collaboration';
import Services from './components/Services';
import Roadmap from './components/Roadmap';
import Dashboard from './pages/Dashboard';
import BrainModel from './components/BrainModel';
import { DifferentialEquationsPage, DSAPage, FluidMechanicsPage } from './pages/SubjectPages';
import BrainCanvas from './components/BrainModel';

// Homepage component that contains all the landing page sections
const HomePage = () => (
  <div className="pt-20 lg:pt-24 overflow-hidden">
    <Header />
    <Hero />
    <Benefits />
    <Collaboration />
    <Services />
    <Roadmap />
  </div>
);

function App() { 
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  return (
    <>
      {/* Only show Header on non-subject pages */}
      {isHomePage && <Header />}
      
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/differential-equations" element={<DifferentialEquationsPage />} />
        <Route path="/dsa" element={<DSAPage />} />
        <Route path="/fluid-mechanics" element={<FluidMechanicsPage />} />
      </Routes>
    </>
  );
}

export default App;