"""Pluggable simulator implementations for FinDependence India."""

from finlib.simulators.wealth_longevity import WealthLongevitySimulator, register_all_simulators

__all__ = ["WealthLongevitySimulator", "register_all_simulators"]

