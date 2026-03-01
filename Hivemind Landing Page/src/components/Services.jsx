import React from 'react';

// Basic components
const Section = ({ children, id }) => (
  <section id={id} className="py-20 relative">
    {children}
  </section>
);

const Heading = ({ title, text }) => (
  <div className="text-center mb-16">
    <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{title}</h2>
    <p className="text-lg text-gray-400">{text}</p>
  </div>
);

// Check icon component
const CheckIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-violet-500 flex-shrink-0"
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

// Generating component
const Generating = ({ className }) => (
  <div className={`flex items-center gap-4 p-4 bg-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl ${className}`}>
    <div className="w-4 h-4 rounded-full bg-violet-500 animate-pulse" />
    <p className="text-sm text-gray-300">AI Assistant is generating...</p>
  </div>
);

// Sample data
const brainwaveServices = [
  "Chat with AI for creative ideas",
  "Generate and edit images with AI",
  "Enhance your content with AI suggestions",
  "24/7 AI-powered assistance"
];

const brainwaveServicesIcons = [
  "/api/placeholder/24/24",
  "/api/placeholder/24/24",
  "/api/placeholder/24/24",
  "/api/placeholder/24/24"
];

const Services = () => {
  return (
    <Section id="how-to-use">
      <div className="container mx-auto px-4">
        <Heading
          title="Generative AI made for creators."
          text="Hivemind unlocks the potential of AI-powered applications"
        />

        <div className="relative">
          {/* Main service card */}
          <div className="relative z-10 flex items-center min-h-[39rem] mb-5 p-8 border border-gray-800 rounded-3xl overflow-hidden lg:p-20">
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none md:w-3/5 xl:w-auto">
              <div className="w-full h-full bg-gradient-to-r from-violet-500/10 to-purple-500/10">
                <img
                  src="/api/placeholder/800/730"
                  className="w-full h-full object-cover md:object-right opacity-50"
                  alt="Smartest AI"
                />
              </div>
            </div>

            <div className="relative z-10 max-w-[17rem] ml-auto">
              <h4 className="text-2xl font-bold text-white mb-4">Smartest AI</h4>
              <p className="text-gray-400 mb-12">
                Hivemind unlocks the potential of AI-powered applications
              </p>
              <ul>
                {brainwaveServices.map((item, index) => (
                  <li
                    key={index}
                    className="flex items-start py-4 border-t border-gray-800"
                  >
                    <CheckIcon />
                    <p className="ml-4 text-gray-300">{item}</p>
                  </li>
                ))}
              </ul>
            </div>

            <Generating className="absolute left-4 right-4 bottom-4 border-gray-800 lg:left-1/2 lg:right-auto lg:bottom-8 lg:-translate-x-1/2" />
          </div>

          {/* Secondary service cards */}
          <div className="relative z-10 grid gap-5 lg:grid-cols-2">
            {/* Photo editing card */}
            <div className="relative min-h-[39rem] border border-gray-800 rounded-3xl overflow-hidden">
              <div className="absolute inset-0">
                <img
                  src="/api/placeholder/630/750"
                  className="h-full w-full object-cover opacity-50"
                  alt="Photo editing"
                />
              </div>

              <div className="absolute inset-0 flex flex-col justify-end p-8 bg-gradient-to-b from-transparent to-gray-900 lg:p-15">
                <h4 className="text-2xl font-bold text-white mb-4">Photo editing</h4>
                <p className="text-gray-400 mb-12">
                  Automatically enhance your photos using our AI app's
                  photo editing feature. Try it now!
                </p>
              </div>

              <div className="absolute top-8 right-8 p-4 bg-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl">
                <p className="text-sm text-gray-300">AI enhancing photo...</p>
              </div>
            </div>

            {/* Video generation card */}
            <div className="p-4 bg-gray-900 rounded-3xl overflow-hidden lg:min-h-[46rem]">
              <div className="py-12 px-4 xl:px-8">
                <h4 className="text-2xl font-bold text-white mb-4">Video generation</h4>
                <p className="text-gray-400 mb-8">
                  The world's most powerful AI photo and video art generation
                  engine. What will you create?
                </p>

                <ul className="flex items-center justify-between mb-8">
                  {brainwaveServicesIcons.map((item, index) => (
                    <li
                      key={index}
                      className={`rounded-2xl flex items-center justify-center ${
                        index === 2
                          ? "w-12 h-12 p-0.5 bg-gradient-to-r from-violet-500 to-purple-500 md:w-16 md:h-16"
                          : "w-10 h-10 bg-gray-800 md:w-14 md:h-14"
                      }`}
                    >
                      <div className={index === 2 ? "flex items-center justify-center w-full h-full bg-gray-900 rounded-xl" : ""}>
                        <img src={item} width={24} height={24} alt="service icon" className="rounded" />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative h-[20rem] bg-gray-800 rounded-xl overflow-hidden md:h-[25rem]">
                <img
                  src="/api/placeholder/520/400"
                  className="w-full h-full object-cover opacity-50"
                  alt="Video generation"
                />

                <div className="absolute bottom-8 left-8 right-8">
                  <div className="p-4 bg-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl">
                    <p className="text-sm text-gray-300">Generating video content...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 via-transparent to-transparent pointer-events-none" />
        </div>
      </div>
    </Section>
  );
};

export default Services;