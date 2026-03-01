import React from 'react';

// Basic components
const Section = ({ children, className = '', id }) => (
  <section id={id} className={`py-20 relative ${className}`}>
    {children}
  </section>
);

const Heading = ({ tag, title }) => (
  <div className="text-center mb-16">
    {tag && <div className="text-violet-500 font-medium mb-4">{tag}</div>}
    <h2 className="text-3xl md:text-4xl font-bold text-white">{title}</h2>
  </div>
);

const Button = ({ href, children }) => (
  <a
    href={href}
    className="inline-flex items-center justify-center px-8 py-4 bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
  >
    {children}
  </a>
);

const Tagline = ({ children }) => (
  <div className="text-sm font-medium text-gray-400">{children}</div>
);

// Status icons
const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-gray-900"
  >
    <path
      d="M13.333 4L5.99967 11.3333L2.66634 8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LoadingIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-gray-900 animate-spin"
  >
    <path
      d="M14 8A6 6 0 112 8a6 6 0 0112 0z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

// Sample roadmap data
const roadmap = [
  {
    id: 1,
    date: "Q1 2024",
    status: "done",
    title: "AI-Powered Learning Interface",
    text: "Launch of our core learning platform with AI-assisted content creation and personalized learning paths.",
    colorful: true,
    imageUrl: "/api/placeholder/628/426"
  },
  {
    id: 2,
    date: "Q2 2024",
    status: "in-progress",
    title: "Collaborative Features",
    text: "Introducing real-time collaboration tools, peer review systems, and group learning capabilities.",
    colorful: false,
    imageUrl: "/api/placeholder/628/426"
  },
  {
    id: 3,
    date: "Q3 2024",
    status: "in-progress",
    title: "Advanced Analytics",
    text: "Implementing detailed learning analytics, progress tracking, and AI-driven recommendations.",
    colorful: true,
    imageUrl: "/api/placeholder/628/426"
  },
  {
    id: 4,
    date: "Q4 2024",
    status: "in-progress",
    title: "Mobile Experience",
    text: "Launching mobile apps with offline learning capabilities and cross-device synchronization.",
    colorful: false,
    imageUrl: "/api/placeholder/628/426"
  }
];

const Roadmap = () => (
  <Section className="overflow-hidden" id="roadmap">
    <div className="container mx-auto px-4 md:pb-10">
      <Heading tag="Ready to get started" title="What we're working on" />
      
      <div className="relative grid gap-6 md:grid-cols-2 md:gap-4 md:pb-28">
        {roadmap.map((item) => {
          const status = item.status === "done" ? "Done" : "In progress";
          
          return (
            <div
              className={`md:flex even:md:translate-y-28 p-0.5 rounded-[2.5rem] ${
                item.colorful ? "bg-gradient-to-r from-violet-500 to-purple-500" : "bg-gray-800"
              }`}
              key={item.id}
            >
              <div className="relative p-8 bg-gray-900 rounded-[2.4375rem] overflow-hidden xl:p-15">
                {/* Grid pattern background */}
                <div className="absolute inset-0 opacity-5">
                  <div className="absolute inset-0" style={{
                    backgroundImage: 'linear-gradient(to right, #666 1px, transparent 1px), linear-gradient(to bottom, #666 1px, transparent 1px)',
                    backgroundSize: '20px 20px'
                  }} />
                </div>

                <div className="relative z-10">
                  <div className="flex items-center justify-between max-w-[27rem] mb-8 md:mb-20">
                    <Tagline>{item.date}</Tagline>
                    <div className="flex items-center px-4 py-1 bg-white rounded">
                      {item.status === "done" ? <CheckIcon /> : <LoadingIcon />}
                      <div className="ml-2 text-sm font-medium text-gray-900">{status}</div>
                    </div>
                  </div>

                  <div className="mb-10 -mx-8 xl:-mx-15">
                    <img
                      className="w-full rounded-lg"
                      src={item.imageUrl}
                      width={628}
                      height={426}
                      alt={item.title}
                    />
                  </div>

                  <h4 className="text-2xl font-bold text-white mb-4">{item.title}</h4>
                  <p className="text-gray-400">{item.text}</p>
                </div>
              </div>
            </div>
          );
        })}

        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 via-transparent to-transparent pointer-events-none" />
      </div>

      <div className="flex justify-center mt-12 md:mt-16 xl:mt-20">
        <Button href="/roadmap">Our roadmap</Button>
      </div>
    </div>
  </Section>
);

export default Roadmap;