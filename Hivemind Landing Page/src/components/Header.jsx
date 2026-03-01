// import { useLocation, useNavigate, Link } from "react-router-dom";
// import { useState } from "react";
// import Button from "./Button";

// // Navigation items
// const navigation = [
//     {
//       id: "0",
//       title: "Features",
//       url: "#features",
//     },
//     {
//       id: "1",
//       title: "Pricing",
//       url: "#pricing",
//     },
//     {
//       id: "2",
//       title: "How to use",
//       url: "#how-to-use",
//     },
//     {
//       id: "3",
//       title: "Roadmap",
//       url: "#roadmap",
//     },
//   ];

// const Header = () => {
//   const location = useLocation();
//   const navigate = useNavigate();
//   const [openNavigation, setOpenNavigation] = useState(false);

//   const toggleNavigation = () => {
//     setOpenNavigation(!openNavigation);
//   };

//   const handleClick = () => {
//     if (!openNavigation) return;
//     setOpenNavigation(false);
//   };

//   const handleSignIn = () => {
//     navigate('/dashboard');
//   };

//   return (
//     <div
//       className={`fixed top-0 left-0 w-full z-50 border-b border-gray-800 
//       ${openNavigation ? "bg-gray-900" : "bg-gray-900/90 backdrop-blur-sm"}`}
//     >
//       <div className="flex items-center px-5 lg:px-8 xl:px-10 max-lg:py-4">
//         <Link to="/" className="block w-48 xl:mr-8">
//           <span className="text-2xl font-bold text-white">Hivemind</span>
//         </Link>

//         <nav
//           className={`${
//             openNavigation ? "flex" : "hidden"
//           } fixed top-20 left-0 right-0 bottom-0 bg-gray-900 lg:static lg:flex lg:mx-auto lg:bg-transparent`}
//         >
//           <div className="relative z-2 flex flex-col items-center justify-center m-auto lg:flex-row">
//             {navigation.map((item) => (
//               <a
//                 key={item.id}
//                 href={item.url}
//                 onClick={handleClick}
//                 className="block relative font-mono text-2xl uppercase text-white transition-colors hover:text-blue-500 px-6 py-6 md:py-8 lg:text-xs lg:font-semibold lg:text-white/50 lg:hover:text-white xl:px-12"
//               >
//                 {item.title}
//               </a>
//             ))}
//           </div>
//         </nav>

//         <div className="ml-auto flex items-center gap-4">
//           <Link
//             to="/dashboard"
//             className="hidden lg:block text-white/50 hover:text-white transition-colors"
//           >
//             New account
//           </Link>
//           <button 
//             onClick={handleSignIn}
//             className="hidden lg:block px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
//           >
//             Sign in
//           </button>
//           <button
//             className="lg:hidden p-2 text-white"
//             onClick={toggleNavigation}
//           >
//             {openNavigation ? "✕" : "☰"}
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default Header;


import { useState } from "react";
import Button from "./Button";

// Navigation items
const navigation = [
    {
      id: "0",
      title: "Features",
      url: "#features",
    },
    {
      id: "1",
      title: "Pricing",
      url: "#pricing",
    },
    {
      id: "2",
      title: "How to use",
      url: "#how-to-use",
    },
    {
      id: "3",
      title: "Roadmap",
      url: "#roadmap",
    },
];

const Header = () => {
  const [openNavigation, setOpenNavigation] = useState(false);

  const toggleNavigation = () => {
    setOpenNavigation(!openNavigation);
  };

  const handleClick = () => {
    if (!openNavigation) return;
    setOpenNavigation(false);
  };

  const handleSignIn = () => {
    window.location.href = '/dashboard.html';
  };

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

  return (
    <div
      className={`fixed top-0 left-0 w-full z-50 border-b border-pink-300 
      ${openNavigation ? "bg-gray-900" : "bg-gray-900 backdrop-blur-sm"}`}
    >
      <div className="flex items-center px-5 lg:px-8 xl:px-10 max-lg:py-4">
        <a className="flex items-center gap-2 xl:mr-8" href="/">
          <div className="w-8 h-8 bg-pink-300/20 rounded-lg flex items-center justify-center">
            <div className="w-6 h-6 text-pink-300">
              <BrainIcon />
            </div>
          </div>
          <span className="text-2xl font-bold text-pink-300">Hivemind</span>
        </a>

        <nav
          className={`${
            openNavigation ? "flex" : "hidden"
          } fixed top-20 left-0 right-0 bottom-0 bg-gray-900 lg:static lg:flex lg:mx-auto lg:bg-transparent`}
        >
          <div className="relative z-2 flex flex-col items-center justify-center m-auto lg:flex-row">
            {navigation.map((item) => (
              <a
                key={item.id}
                href={item.url}
                onClick={handleClick}
                className="block relative font-mono uppercase text-2xl text-yellow-400 transition-colors hover:text-pink-300 px-6 py-6 md:py-8 lg:text-xl lg:font-semibold lg:text-white lg:hover:text-pink-300 xl:px-12"
              >
                {item.title}
              </a>
            ))}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <a
            href="/dashboard.html"
            className="hidden lg:block lg:text-xl font-mono uppercase text-white hover:text-pink-300 transition-colors"
          >
            New account
          </a>
          <button 
            onClick={handleSignIn}
            className="hidden lg:block px-4 py-2 bg-pink-300 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Sign in
          </button>
          <button
            className="lg:hidden p-2 text-white"
            onClick={toggleNavigation}
          >
            {openNavigation ? "✕" : "☰"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Header;