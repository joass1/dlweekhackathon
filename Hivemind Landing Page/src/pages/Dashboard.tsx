import React from 'react';
import BrainCanvas from '../components/BrainModel';
// Sample activity data
import { 
  LineChart, 
  Users, 
  ClipboardList, 
  Network, 
  Brain 
} from 'lucide-react';

const NavButton = ({ icon: Icon, text, href }) => (
  <a
    href={href}
    className="flex items-center gap-3 px-4 py-3 rounded-xl
      bg-gray-800/80 backdrop-blur-sm border border-violet-500/20
      text-white hover:bg-gray-700/80 hover:border-violet-500/40
      transition-colors duration-300 shadow-lg hover:shadow-violet-500/20
      w-full"
  >
    <Icon className="w-5 h-5 text-violet-400" />
    <span>{text}</span>
  </a>
);

const SideNavigation = () => (
  <div className="fixed left-8 top-25 space-y-3 w-48 z-10">
    <NavButton icon={LineChart} text="Progress" href="/progress" />
    <NavButton icon={Users} text="Groups" href="/groups" />
    <NavButton icon={ClipboardList} text="Assessment" href="/assessment" />
    <NavButton icon={Network} text="Network Balance" href="/network" />
    <NavButton icon={Brain} text="Hive Intelligence" href="/hive" />
  </div>
);

const activityItems = [
  {
    id: 1,
    user: "John Doe",
    action: "uploaded",
    target: "Navier-Stokes Equations.pdf",
    subject: "Fluid Mechanics",
    time: "2 hours ago"
  },
  {
    id: 2,
    user: "Jane Smith",
    action: "commented on",
    target: "Binary Trees Assignment",
    subject: "Data Structures",
    time: "3 hours ago"
  },
  {
    id: 3,
    user: "Alex Wilson",
    action: "shared",
    target: "Second Order DEs.pdf",
    subject: "Differential Equations",
    time: "5 hours ago"
  }
];

const aiUpdates = [
  {
    id: 1,
    message: "New learning pattern detected in your Fluid Mechanics submissions",
    time: "1 hour ago"
  },
  {
    id: 2,
    message: "Recommended: Review Binary Tree Traversal based on recent activity",
    time: "3 hours ago"
  }
];

const BrainIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="w-full h-full"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2C7.58172 2 4 5.58172 4 10C4 12.9767 5.50428 15.587 7.79446 17.1116C7.35605 17.4964 7 17.9889 7 18.5714C7 19.5866 7.89837 20.4286 9 20.4286H15C16.1016 20.4286 17 19.5866 17 18.5714C17 17.9889 16.6439 17.4964 16.2055 17.1116C18.4957 15.587 20 12.9767 20 10C20 5.58172 16.4183 2 12 2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 14C14.2091 14 16 12.2091 16 10C16 7.79086 14.2091 6 12 6C9.79086 6 8 7.79086 8 10C8 12.2091 9.79086 14 12 14Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 6V2M15 8L18 6M15 12L18 14M9 12L6 14M9 8L6 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const UserProfile = () => (
  <div className="absolute top-6 left-7 flex items-center gap-4 bg-gray-800 p-2 rounded-xl">
    <div className="flex flex-col items-end">
      <span className="text-white font-medium">John Doe</span>
      <span className="text-sm text-gray-400">john@example.com</span>
    </div>
    <div className="w-10 h-10 rounded-full bg-violet-500 flex items-center justify-center text-white font-bold">
      JD
    </div>
  </div>
);

interface FloatingButtonProps {
  text: string;
  orbitClass: string;
  className?: string;
  href: string;
}

const FloatingButton = ({ text, className = '', orbitClass, href }: FloatingButtonProps) => (
  <div className={`absolute ${orbitClass}`}>
    <a
      href={href}
      className={`
        px-6 py-3 
        bg-gray-800/80 
        backdrop-blur-sm 
        border border-violet-500/20 
        rounded-xl 
        text-white 
        hover:bg-gray-700/80 
        hover:border-violet-500/40 
        transition-colors
        duration-300
        shadow-lg
        hover:shadow-violet-500/20
        whitespace-nowrap
        ${className}
      `}
    >
      {text}
    </a>
  </div>
);

const WarpBackground = () => (
  <div className="absolute inset-0 overflow-hidden">
    <div className="absolute inset-0 animate-warp-1 opacity-30">
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/0 via-violet-500/50 to-violet-500/0 blur-3xl transform rotate-12" />
    </div>
    <div className="absolute inset-0 animate-warp-2 opacity-20">
      <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/50 to-purple-500/0 blur-3xl transform -rotate-12" />
    </div>
    <div className="absolute inset-0 animate-warp-3 opacity-10">
      <div className="absolute inset-0 bg-gradient-to-b from-violet-500/0 via-violet-500/50 to-violet-500/0 blur-3xl" />
    </div>
    
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 via-white/0 to-transparent animate-pulse" 
         style={{ backgroundSize: '2px 2px', backgroundRepeat: 'repeat' }} />
  </div>
);

const BottomCards = () => (
  <div className="absolute bottom-8 left-0 right-0 px-8">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto">
      {/* Hivemind Activity Card */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-violet-500/20 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-4">Hivemind Activity</h3>
        <div className="space-y-4">
          {activityItems.map(item => (
            <div key={item.id} className="flex items-start gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5" />
              <div>
                <p className="text-gray-300">
                  <span className="text-white font-medium">{item.user}</span>{' '}
                  {item.action}{' '}
                  <span className="text-white">{item.target}</span>{' '}
                  in{' '}
                  <span className="text-violet-400">{item.subject}</span>
                </p>
                <p className="text-gray-500 text-xs mt-1">{item.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge AI Card */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-violet-500/20 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-4">Knowledge AI</h3>
        <div className="flex flex-col items-center justify-center h-[calc(100%-2rem)]">
          <div className="w-16 h-16 bg-violet-500/20 rounded-xl flex items-center justify-center mb-4">
            <BrainIcon />
          </div>
          <p className="text-gray-300 text-center">
            Ask me anything about your subjects
          </p>
          <button className="mt-4 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-lg transition-colors">
            Start a conversation
          </button>
        </div>
      </div>

      {/* AI Updates Card */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-violet-500/20 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-4">Updates from your AI agent</h3>
        <div className="space-y-4">
          {aiUpdates.map(update => (
            <div key={update.id} className="p-3 bg-violet-500/10 rounded-lg">
              <p className="text-gray-300">{update.message}</p>
              <p className="text-gray-500 text-xs mt-2">{update.time}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const Dashboard = () => {
  return (
    <div className="min-h-screen pb-48 bg-gray-900 relative overflow-hidden">
      <WarpBackground />
      <SideNavigation />
      <UserProfile />
      
      <div className="absolute inset-0 flex flex-col items-center justify-start pt-40">
        <div className="relative w-64 h-64 md:w-96 md:h-96">
          <div className="relative w-full h-full">
            <div className="absolute inset-0 bg-violet-500/20 rounded-full animate-pulse" />
            <div className="absolute inset-0 border-4 border-violet-500/50 rounded-full animate-[spin_10s_linear_infinite]" />
            <div className="absolute inset-4 bg-gradient-to-b from-violet-500 to-purple-600 rounded-full overflow-hidden">
              <div className="w-full h-full relative">
                <BrainCanvas />
              </div>
            </div>
          </div>

          <div className="absolute inset-0">
            <FloatingButton 
              text="Fluid Mechanics"
              orbitClass="animate-orbit-1 w-full h-full"
              href="/fluid-mechanics"
            />
            <FloatingButton 
              text="Data Structures and Algorithms"
              orbitClass="animate-orbit-2 w-full h-full"
              href="/dsa"
            />
            <FloatingButton 
              text="Differential Equations"
              orbitClass="animate-orbit-3 w-full h-full"
              href="/differential-equations"
            />
          </div>
        </div>
        
        <h1 className="mt-8 text-4xl font-bold text-white">Welcome to Hivemind</h1>
        <p className="mt-4 text-xl text-gray-400">Your AI-powered learning journey begins here</p>
      </div>

      <BottomCards />

      <style>{`
        @keyframes orbit-1 {
          0% { transform: rotate(0deg) translateX(100px) rotate(0deg); z-index: 20; }
          25% { transform: rotate(90deg) translateX(100px) rotate(-90deg); z-index: 5; }
          75% { transform: rotate(270deg) translateX(100px) rotate(-270deg); z-index: 5; }
          100% { transform: rotate(360deg) translateX(100px) rotate(-360deg); z-index: 20; }
        }
        
        @keyframes orbit-2 {
          0% { transform: rotate(120deg) translateX(100px) rotate(-120deg); z-index: 20; }
          25% { transform: rotate(210deg) translateX(100px) rotate(-210deg); z-index: 5; }
          75% { transform: rotate(390deg) translateX(100px) rotate(-390deg); z-index: 5; }
          100% { transform: rotate(480deg) translateX(100px) rotate(-480deg); z-index: 20; }
        }
        
        @keyframes orbit-3 {
          0% { transform: rotate(240deg) translateX(100px) rotate(-240deg); z-index: 20; }
          25% { transform: rotate(330deg) translateX(100px) rotate(-330deg); z-index: 5; }
          75% { transform: rotate(510deg) translateX(100px) rotate(-510deg); z-index: 5; }
          100% { transform: rotate(600deg) translateX(100px) rotate(-600deg); z-index: 20; }
        }

        .animate-orbit-1 {
          animation: orbit-1 20s linear infinite;
        }
        
        .animate-orbit-2 {
          animation: orbit-2 20s linear infinite;
        }
        
        .animate-orbit-3 {
          animation: orbit-3 20s linear infinite;
        }

        @media (min-width: 768px) {
          @keyframes orbit-1 {
            0% { transform: rotate(0deg) translateX(50px) rotate(0deg); z-index: 20; }
            25% { transform: rotate(90deg) translateX(50px) rotate(-90deg); z-index: 5; }
            75% { transform: rotate(270deg) translateX(50px) rotate(-270deg); z-index: 5; }
            100% { transform: rotate(360deg) translateX(50px) rotate(-360deg); z-index: 20; }
          }
          
          @keyframes orbit-2 {
            0% { transform: rotate(120deg) translateX(110px) rotate(-120deg); z-index: 20; }
            25% { transform: rotate(210deg) translateX(110px) rotate(-210deg); z-index: 5; }
            75% { transform: rotate(390deg) translateX(110px) rotate(-390deg); z-index: 5; }
            100% { transform: rotate(480deg) translateX(110px) rotate(-480deg); z-index: 20; }
          }
          
          @keyframes orbit-3 {
            0% { transform: rotate(240deg) translateX(-120px) rotate(-240deg); z-index: 20; }
            25% { transform: rotate(330deg) translateX(-120px) rotate(-330deg); z-index: 5; }
            75% { transform: rotate(510deg) translateX(-120px) rotate(-510deg); z-index: 5; }
            100% { transform: rotate(600deg) translateX(-120px) rotate(-600deg); z-index: 20; }
          }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;