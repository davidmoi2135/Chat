import React,{useState} from 'react';
import Chat from './components/Chat';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
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
  console.log('App: handleLogout called (before state change)');
  setIsLoggedIn(false);
  setUsername('');
  console.log('App: state after logout requested, isLoggedIn should be false');
  };
  if(!isLoggedIn){
    return (
      <div className='flex items-center justify-center h-screen bg-gray-100'>
        <div className='p-8 bg-white rounded-lg shadow-xl w-full sm:w-96'>
            <h1 className='text-3xl font-semibold text-center mb-6 flex items-center justify-center space-x-2'>
              <ChatBubbleLeftIcon className='w-8 h-8 text-orange-500' />
              <span className='text-xl'>
                Welcome to the Chat App!
              </span>
            </h1>
            <label className='text-sm text-gray-600 block mb-2'>Room ID (e.g. 1)</label>
            <input
              type='number'
              value={roomId}
              onChange={(e) => {
                // ensure integer and min 1
                const val = Math.max(1, Math.floor(Number(e.target.value) || 1));
                setRoomId(val);
              }}
              placeholder='Room ID (e.g.: 1)'
              aria-label='Enter Room ID'
              className='w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300'
            />
            <label className='text-sm text-gray-600 block mb-2'>Username</label>
            <input
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder='Enter your name'
              aria-label='Enter name'
              className='w-full p-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300'
              onKeyDown={handleKeyDown}
            />
            <button 
            disabled={username.trim() === ''}
            onClick={() => setIsLoggedIn(true)} className='w-full p-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600'>
              Join Chat
            </button>
        </div>
        
      </div>
    )
  }
  return <Chat username={username} roomId={String(roomId)} onLogout={handleLogout} />;
}

export default App;
