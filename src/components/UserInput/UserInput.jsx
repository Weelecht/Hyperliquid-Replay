import React from 'react';
import './UserInput.css';

const UserInput = ({
  label,
  type = 'text',
  placeholder,
  value,
  onChange,
  name,
  id,
  required = false,
  disabled = false,
  error,
  className = '',
  ...props
}) => {
  const inputId = id || name || `input-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className={`user-input-container ${className}`}>
      {label && (
        <label htmlFor={inputId} className="user-input-label">
          {label}
          {required && <span className="required">*</span>}
        </label>
      )}
      
      <input
        id={inputId}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        className={`user-input ${error ? 'user-input-error' : ''}`}
        {...props}
      />
      
      {error && (
        <div className="user-input-error-message">
          {error}
        </div>
      )}
    </div>
  );
};

export default UserInput; 