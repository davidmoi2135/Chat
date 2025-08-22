import React,{useState} from 'react';
import Chat from './components/Chat';
import { ChatBubbleLeftIcon, SparklesIcon } from '@heroicons/react/24/outline';

const gradientBg = 'bg-gradient-to-br from-pink-400 via-purple-400 to-blue-400';
const glassBg = 'bg-white/70 backdrop-blur-lg shadow-2xl border border-white/30';

const App: React.FC = () => {
  const [username,setUsername]=useState<string>('');
  const [roomId, setRoomId] = useState<number>(1);
  const [isLoggedIn,setIsLoggedIn]=useState<boolean>(false);
  const handleKeyDown = (e:React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter'&& username.trim() !== '') {
      setIsLoggedIn(true);
    }
  };
  const handleLogout = () => {
    setIsLoggedIn(false);
    setUsername('');
  };
  if(!isLoggedIn){
    return (
      <div className={`flex items-center justify-center min-h-screen ${gradientBg}`}>
        <div className={`p-8 rounded-2xl ${glassBg} w-full sm:w-96 relative animate__animated animate__fadeInDown`}>
          <div className='absolute -top-8 left-1/2 -translate-x-1/2 flex items-center justify-center'>
            <SparklesIcon className='w-12 h-12 text-yellow-400 drop-shadow-lg animate-bounce' />
          </div>
          <h1 className='text-4xl font-extrabold text-center mb-6 flex items-center justify-center space-x-2 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent'>
            <ChatBubbleLeftIcon className='w-10 h-10 text-orange-500 drop-shadow' />
            <span className='text-2xl'>Welcome to <span className='font-black'>ChatApp</span>!</span>
          </h1>
          {/* Xóa dòng slogan màu mè */}
          <label className='text-sm text-gray-700 block mb-2 font-bold'>Room ID</label>
          <input
            type='number'
            value={roomId}
            onChange={(e) => {
              const val = Math.max(1, Math.floor(Number(e.target.value) || 1));
              setRoomId(val);
            }}
            placeholder='Room ID (e.g.: 1)'
            aria-label='Enter Room ID'
            className='w-full p-3 border border-purple-300 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-300 bg-white/80'
          />
          <label className='text-sm text-gray-700 block mb-2 font-bold'>Username</label>
          <input
            type='text'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder='Enter your name'
            aria-label='Enter name'
            className='w-full p-3 border border-purple-300 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 bg-white/80'
            onKeyDown={handleKeyDown}
          />
          <button 
            disabled={username.trim() === ''}
            onClick={() => setIsLoggedIn(true)}
            className='w-full p-3 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white rounded-xl font-bold shadow-lg hover:scale-105 transition-all duration-200'>
            🚀 Join Chat
          </button>
        </div>
      </div>
    )
  }
  return <Chat username={username} roomId={String(roomId)} onLogout={handleLogout} />;
}

export default App;
