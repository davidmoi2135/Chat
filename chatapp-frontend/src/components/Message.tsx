import * as React from 'react';
interface MessageProps {
  sender: string;
  content: string;
  isOwnMessage: boolean;
}

const Message: React.FC<MessageProps> = ({ sender, content, isOwnMessage }) => {
  return (
    <div className={`message ${isOwnMessage ? 'own' : ''}`}>
      <strong>{sender}</strong>: {content}
    </div>
  );
};

export default Message;
export {};
