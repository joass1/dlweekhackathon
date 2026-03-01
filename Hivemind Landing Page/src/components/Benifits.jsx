import React from 'react';

// Simplified Section component
const Section = ({ children, id }) => (
  <section id={id} className="py-20 relative">
    {children}
  </section>
);

// Simplified Heading component
const Heading = ({ title, className = '' }) => (
  <div className={`text-center mb-12 ${className}`}>
    <h2 className="text-4xl font-bold text-white mb-4">{title}</h2>
  </div>
);

// Arrow component
const Arrow = () => (
  <svg
    className="w-6 h-6 text-violet-500 ml-2"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5 12H19M19 12L12 5M19 12L12 19"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// GradientLight component
const GradientLight = () => (
  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/25 to-transparent pointer-events-none" />
);

// Sample benefits data
const benefits = [
  {
    id: 1,
    title: "Smart Conversations",
    text: "Experience AI-powered conversations that adapt to your needs and learning style.",
    iconUrl: "/api/placeholder/48/48",
    light: true,
  },
  {
    id: 2,
    title: "Quick Responses",
    text: "Get instant, accurate responses to your questions with advanced AI technology.",
    iconUrl: "/api/placeholder/48/48",
    light: false,
  },
  {
    id: 3,
    title: "Learning Analytics",
    text: "Track your progress and improve your learning with detailed analytics and insights.",
    iconUrl: "/api/placeholder/48/48",
    light: true,
  }
];

const Benefits = () => {
  return (
    <Section id="features">
      <div className="container mx-auto px-4 relative z-10">
        <Heading
          className="md:max-w-md lg:max-w-2xl mx-auto"
          title="Chat Smarter, Not Harder with Hivemind"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {benefits.map((item) => (
            <div
              key={item.id}
              className="relative rounded-2xl overflow-hidden group"
            >
              <div className="relative z-10 bg-gray-900 p-8 h-full border border-gray-800 rounded-2xl transition-transform duration-300 group-hover:-translate-y-1">
                <div className="flex flex-col min-h-[22rem]">
                  <h5 className="text-xl font-bold text-white mb-4">{item.title}</h5>
                  <p className="text-gray-400 mb-6 flex-grow">{item.text}</p>
                  
                  <div className="flex items-center mt-auto">
                    <img
                      src={item.iconUrl}
                      width={48}
                      height={48}
                      alt={item.title}
                      className="rounded"
                    />
                    <p className="ml-auto font-mono text-xs font-bold text-gray-300 uppercase tracking-wider">
                      Explore more
                    </p>
                    <Arrow />
                  </div>
                </div>
                
                {item.light && <GradientLight />}
              </div>
              
              <div className="absolute inset-0 bg-gradient-to-r from-violet-500/20 via-purple-500/20 to-violet-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
};

export default Benefits; // vespa_cloud_NlshfUgQwaxRFSaH1T6EP6QblULHfU32O6R9wiIFk1Z