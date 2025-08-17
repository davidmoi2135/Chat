import React,{useState,useRef, useEffect} from 'react';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { PaperAirplaneIcon, UserPlusIcon, MinusIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
interface ChatProps {
    username: string;
    roomId?: string | number;
    onLogout?: () => void;
}

const Chat: React.FC<ChatProps> = ({ username, roomId, onLogout}) => {
    const [messages, setMessages] = useState<any[]>([]);
    const [message, setMessage] = useState<string>('');
    const [stompClient, setStompClient] = useState<Client | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // track last sent message to dedupe server echo
    const lastSentRef = useRef<{ content: string; ts: number } | null>(null);

    // member list state
    const [members, setMembers] = useState<string[]>([]);
    const [showMembers, setShowMembers] = useState<boolean>(false);

    // normalize room id to string for comparisons
    const currentRoom = roomId !== undefined && roomId !== null ? String(roomId) : null;

    const addMember = (name: string) => {
        if (!name) return;
        setMembers((prev) => (prev.includes(name) ? prev : [...prev, name]));
    };
    const removeMember = (name: string) => {
        if (!name) return;
        setMembers((prev) => prev.filter((m) => m !== name));
    };

    const sendMessage = () => {
        if (message.trim() && stompClient) {
            const chatMessage = {
                sender: username,
                content: message,
                type: 'CHAT',
                roomId: currentRoom,
            };

            // optimistic UI: append locally so user sees message immediately
            lastSentRef.current = { content: message, ts: Date.now() };
            setMessages((prev) => [...prev, { ...chatMessage, isLocal: true }] );

            // backend expects /app/sendMessage (unchanged). include roomId in payload so server will echo it back.
            stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(chatMessage) });
            setMessage('');
            inputRef.current?.focus();
        }
    }

    const handleLogout = () => {
        try {
            // try to notify server before leaving UI by sending a LEAVE message to /app/sendMessage
            if (stompClient) {
                try {
                    const leaveMsg = {
                        sender: username,
                        content: username + ' has left',
                        type: 'LEAVE',
                        roomId: currentRoom,
                    };
                    stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(leaveMsg) });
                } catch (err) {
                    // ignore publish errors
                }
            }
        } catch (e) {
            console.error('error during logout notify', e);
        }

        // call onLogout first so App will set isLoggedIn=false and unmount this component
        console.log('Chat: handleLogout called, calling onLogout');
        try {
            onLogout?.();
            console.log('Chat: onLogout invoked');
        } catch (e) {
            console.error('Chat: error calling onLogout', e);
        }

        // cleanup (deactivate) will run in the effect cleanup after unmount
    };

    useEffect(() => {
        // create STOMP client using @stomp/stompjs and SockJS transport
        const client = new Client({
            webSocketFactory: () => new SockJS('http://localhost:8080/chat-websocket') as any,
            reconnectDelay: 5000,
            onConnect: (frame) => {
                console.log('STOMP connected', frame);

                // subscribe to private member list destination first so server can send the current members to this session
                try {
                    client.subscribe('/user/queue/members', (m: any) => {
                        if (!m || !m.body) return;
                        try {
                            const list = JSON.parse(m.body);
                            if (Array.isArray(list)) {
                                setMembers(list);
                            }
                        } catch (err) {
                            // ignore parse errors
                        }
                    });
                } catch (err) {
                    console.warn('subscribe to user queue members failed', err);
                }

                // then subscribe to global topic
                const subDest = '/topic/message';
                client.subscribe(subDest, (msg: any) => {
                    if (!msg || !msg.body) return;
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(msg.body);
                    } catch (err) {
                        // if body is raw string, wrap into an object
                        parsed = { content: msg.body };
                    }

                    // If frontend has a roomId selected, only accept messages that carry the same roomId.
                    const msgRoom = parsed.roomId ?? null;
                    if (currentRoom) {
                        if (msgRoom && String(msgRoom) !== currentRoom) return; // different room -> ignore
                        if (!msgRoom) return; // message without room -> ignore when a room is selected
                    }

                    // handle membership messages
                    const type = (parsed.type || '').toString().toUpperCase();
                    if (type === 'JOIN') {
                        addMember(parsed.sender);
                    } else if (type === 'LEAVE') {
                        removeMember(parsed.sender);
                    }

                    // dedupe: if this is an echo of the last sent local message, replace the optimistic entry
                    if (
                        parsed.sender === username &&
                        lastSentRef.current &&
                        parsed.content === lastSentRef.current.content &&
                        Date.now() - lastSentRef.current.ts < 5000
                    ) {
                        setMessages((prev) => {
                            const idx = prev.findIndex((m) => m.isLocal && m.sender === username && m.content === parsed.content);
                            if (idx >= 0) {
                                // remove optimistic message and append server message
                                const copy = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
                                return [...copy, parsed];
                            }
                            return [...prev, parsed];
                        });
                        lastSentRef.current = null;
                        return;
                    }

                    setMessages((prev) => [...prev, parsed]);
                });

                // now publish JOIN so server will add member and (should) send private members list to this session
                try {
                    const joinMsg = {
                        sender: username,
                        content: username + ' has joined',
                        type: 'JOIN',
                        roomId: currentRoom,
                    };
                    client.publish({ destination: '/app/sendMessage', body: JSON.stringify(joinMsg) });
                    // assume we are a member locally for immediate feedback
                    addMember(username);
                } catch (e) {
                    console.error('publish join error', e);
                }
            },
            onStompError: (frame) => {
                console.error('STOMP error', frame);
            }
        });

        client.activate();
        setStompClient(client);

        return () => {
            try {
                // attempt to notify server we're leaving the room by sending a LEAVE message to /app/sendMessage
                try {
                    const leaveMsg = {
                        sender: username,
                        content: username + ' has left',
                        type: 'LEAVE',
                        roomId: currentRoom,
                    };
                    client.publish({ destination: '/app/sendMessage', body: JSON.stringify(leaveMsg) });
                } catch (err) {
                    // ignore publish errors during teardown
                }
                // remove self from members locally
                removeMember(username);
                client.deactivate();
            } catch (e) {
                console.error('client deactivate error', e);
            }
        };
    }, [username, currentRoom]);

    // scroll to bottom when messages update
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    return (
        <div className='flex justify-center items-center min-h-screen bg-gray-100'>
            <div className='flex flex-col bg-white rounded-lg shadow-xl w-full sm:w[29rem] h-[700px]'>
                 {/* Chat Room Header */}
                  <div className='relative p-4 bg-blue-500 text-white font-semibold text-center rounded-t-xl'>
                       <div className='absolute right-3 top-3 flex items-center space-x-2'>
                           <div className='text-sm bg-blue-700 px-3 py-1 rounded-full'>Room: {currentRoom ?? '—'}</div>
                           <button aria-label='Show members' title='Show members' onClick={() => setShowMembers(true)} className='p-1 rounded-full hover:bg-blue-600'>
                               <ExclamationCircleIcon className='w-5 h-5 text-white' />
                           </button>
                       </div>
                       <div>Chat Room</div>
                  </div>

                  {/* Members modal */}
                  {showMembers && (
                      <div className='fixed inset-0 bg-black/40 flex items-center justify-center z-40'>
                          <div className='bg-white rounded-lg w-80 max-h-[60vh] overflow-auto p-4'>
                              <div className='flex justify-between items-center mb-3'>
                                  <h3 className='font-semibold'>Members in room</h3>
                                  <button onClick={() => setShowMembers(false)} className='text-sm text-gray-600'>Close</button>
                              </div>
                              <ul>
                                  {members.length === 0 && <li className='text-sm text-gray-500'>No members yet</li>}
                                  {members.map((m) => (
                                      <li key={m} className='flex items-center justify-between py-1 border-b last:border-b-0'>
                                          <div className='flex items-center space-x-2'>
                                              <div className='w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-sm font-semibold text-gray-700'>{m.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div>
                                              <span className='text-sm'>{m}</span>
                                          </div>
                                      </li>
                                  ))}
                              </ul>
                          </div>
                      </div>
                  )}

                  {/* Chat Messages */}
                  <div className='flex-1 overflow-y-auto p-4 flex flex-col justify-end'>
                      {messages.map((msg, index) => {
                          const type = (msg.type || '').toString().toUpperCase();
                          // system messages (join/leave) show centered small text with icon
                          if (type === 'JOIN' || type === 'LEAVE' || type === 'SYSTEM') {
                              const isSelf = msg.sender === username;
                              let text = msg.content;
                              // prefer server-provided content; otherwise provide English fallback
                              if (!text) {
                                  if (type === 'JOIN') text = isSelf ? 'You joined' : (msg.sender ? `${msg.sender} joined` : 'Someone joined');
                                  if (type === 'LEAVE') text = isSelf ? 'You left' : (msg.sender ? `${msg.sender} left` : 'Someone left');
                              }
                              const Icon = type === 'LEAVE' ? MinusIcon : UserPlusIcon;
                              return (
                                  <div key={index} className='w-full flex justify-center my-2'>
                                      <div className='inline-flex items-center text-sm text-gray-500 bg-transparent space-x-2'>
                                          <Icon className='w-4 h-4 text-gray-500' />
                                          <span>{text}</span>
                                      </div>
                                  </div>
                              );
                          }

                          const isOwn = msg.sender === username;
                          const initials = (msg.sender || '')
                              .split(' ')
                              .map((s: string) => s[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase() || '?';
                          return (
                              <div key={index} className={`my-2 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  {isOwn ? (
                                      <div className='flex items-end space-x-2'>
                                          <div className={`max-w-[70%] p-3 rounded-lg break-words bg-blue-500 text-white rounded-br-none`}>
                                              <div>{msg.content}</div>
                                          </div>
                                          <div className='w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold'>
                                              {initials}
                                          </div>
                                      </div>
                                  ) : (
                                      <div className='flex items-end space-x-2'>
                                          <div className='w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-semibold'>
                                              {initials}
                                          </div>
                                          <div className={`max-w-[70%] p-3 rounded-lg break-words bg-gray-200 text-gray-900 rounded-bl-none`}>
                                              <div className='text-sm font-semibold mb-1'>{msg.sender}</div>
                                              <div>{msg.content}</div>
                                          </div>
                                      </div>
                                  )}
                              </div>
                          );
                      })}
                      <div ref={messagesEndRef} />
                  </div>
                  {/* Chat Input */}
                  <div className='p-4 border-t flex items-center space-x-2'>
                      <input
                          type='text'
                          ref={inputRef}
                          className='border rounded-lg p-2 flex-1'
                          placeholder='Type your message...'
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          onKeyDown={(e) => {
                              if (e.key === 'Enter' && message.trim()) {
                                  sendMessage();
                              }
                          }}
                      />
                      <button
                            className='bg-blue-500 text-white rounded-full p-2 ml-2 flex items-center justify-center'
                            onClick={sendMessage}
                            aria-label='Send message'
                        >
                            <PaperAirplaneIcon className='w-5 h-5' />
                        </button>
                  </div>
                 {/* Button logout */}
                 <div className='p-4 text-center border-t bg-gray-50'>
                    <button
                        type='button'
                        onClick={() => { console.log('Logout button clicked'); handleLogout(); }}
                        className='w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition duration-300'
                    >
                        Logout
                    </button>
                 </div>
            </div>
        </div>
    );
}
export default Chat;