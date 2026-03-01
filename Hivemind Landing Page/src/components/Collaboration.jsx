import React from 'react';

// Basic Section component
const Section = ({ children, crosses }) => (
  <section className="py-20 relative">
    {crosses && (
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-8 w-4 h-4 border-t-2 border-l-2 border-violet-500/20" />
        <div className="absolute bottom-20 right-8 w-4 h-4 border-b-2 border-r-2 border-violet-500/20" />
      </div>
    )}
    {children}
  </section>
);

// Button component
const Button = ({ children }) => (
  <button className="px-6 py-3 bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors">
    {children}
  </button>
);

// Check icon component
const CheckIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-violet-500"
  >
    <path
      d="M20 6L9 17L4 12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Sample collaboration content
const collabContent = [
  {
    id: 1,
    title: "Real-time collaboration",
    text: "Work together with your team in real-time with shared workspaces"
  },
  {
    id: 2,
    title: "Smart integrations",
    text: "Connect with your favorite tools seamlessly"
  },
  {
    id: 3,
    title: "Advanced AI features",
    text: "Leverage cutting-edge AI to enhance your workflow"
  }
];

// Sample collaboration apps
const collabApps = [
  { id: 1, title: "Figma", icon: "/api/placeholder/32/32" },
  { id: 2, title: "Notion", icon: "/api/placeholder/32/32" },
  { id: 3, title: "Discord", icon: "/api/placeholder/32/32" },
  { id: 4, title: "Slack", icon: "/api/placeholder/32/32" },
  { id: 5, title: "VS Code", icon: "/api/placeholder/32/32" },
  { id: 6, title: "Gmail", icon: "/api/placeholder/32/32" },
  { id: 7, title: "Zoom", icon: "/api/placeholder/32/32" },
  { id: 8, title: "Linear", icon: "/api/placeholder/32/32" }
];

const Collaboration = () => {
  return (
    <Section crosses>
      <div className="container mx-auto px-4 lg:flex">
        <div className="max-w-sm">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 md:mb-8">
            AI Chat App for seamless collaboration
          </h2>
          
          <ul className="max-w-sm mb-10 md:mb-14">
            {collabContent.map((item) => (
              <li className="mb-3 py-3" key={item.id}>
                <div className="flex items-center">
                  <CheckIcon />
                  <h6 className="ml-5 text-white font-medium">{item.title}</h6>
                </div>
                {item.text && (
                  <p className="mt-3 text-gray-400">{item.text}</p>
                )}
              </li>
            ))}
          </ul>
          
          <Button>Try it now</Button>
        </div>

        <div className="lg:ml-auto xl:w-[38rem] mt-4">
          <p className="text-gray-400 mb-8 md:mb-16 lg:mb-32 lg:w-[22rem] lg:mx-auto">
            Connect with your team and collaborate with our integrated tools and AI assistance.
          </p>

          <div className="relative left-1/2 flex w-[22rem] aspect-square border border-gray-800 rounded-full -translate-x-1/2 scale-75 md:scale-100">
            {/* Center circle with logo */}
            <div className="flex w-60 aspect-square m-auto border border-gray-800 rounded-full">
              <div className="w-24 aspect-square m-auto p-1 bg-gradient-to-r from-violet-500 to-purple-500 rounded-full">
                <div className="flex items-center justify-center w-full h-full bg-gray-900 rounded-full">
                  <div className="w-8 h-8 bg-violet-500 rounded-lg" />
                </div>
              </div>
            </div>

            {/* Orbiting app icons */}
            <ul>
              {collabApps.map((app, index) => (
                <li
                  key={app.id}
                  className="absolute top-0 left-1/2 h-1/2 -ml-6"
                  style={{ 
                    transform: `rotate(${index * 45}deg)`,
                  }}
                >
                  <div
                    className="relative -top-6 flex w-12 h-12 bg-gray-800 border border-gray-700 rounded-xl"
                    style={{ 
                      transform: `rotate(-${index * 45}deg)`,
                    }}
                  >
                    <img
                      className="m-auto rounded"
                      width={32}
                      height={32}
                      alt={app.title}
                      src={app.icon}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/* Decorative curves */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute -left-8 top-1/2 w-16 h-16 border-t-2 border-l-2 border-violet-500/20 rounded-tl-full" />
              <div className="absolute -right-8 top-1/2 w-16 h-16 border-t-2 border-r-2 border-violet-500/20 rounded-tr-full" />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
};

export default Collaboration;