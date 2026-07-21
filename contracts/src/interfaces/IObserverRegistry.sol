pragma solidity 0.8.30;

interface IObserverRegistry {
    event ObserverStatusChanged(address indexed observer, bool active);
    event SignatureThresholdChanged(uint8 previousThreshold, uint8 newThreshold);

    function setObserver(address observer, bool active) external;
    function setSignatureThreshold(uint8 nextThreshold) external;
    function isObserver(address observer) external view returns (bool);
    function signatureThreshold() external view returns (uint8);
}
