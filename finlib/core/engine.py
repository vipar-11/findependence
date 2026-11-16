"""
Simulation Engine & Pluggable Feature Registry for FinDependence India.

Provides:
1. `BaseSimulator` & `SimulatorRegistry` for plugging in, activating, or retiring
   financial independence simulators, calculators, and analyzers with minimal maintenance.
2. `generate_monte_carlo_paths`: Random historical sampling (IID bootstrap, block bootstrap,
   and correlated multivariate normal) calibrated to Indian market history (1991-2025).
3. `generate_historical_backtest_paths`: Rolling historical window generator across
   actual Indian market cycles.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, replace
from typing import Any, Literal
import secrets
import numpy as np

from finlib.data.indian_market_history import get_historical_arrays

SamplingMethod = Literal["iid_bootstrap", "block_bootstrap", "parametric_correlated"]
ModuleStatus = Literal["active", "coming_soon", "retired"]
ModuleType = Literal["simulator", "analyzer", "calculator"]


@dataclass(frozen=True)
class SimulatorMetadata:
    """Metadata describing a pluggable FinDependence module/function."""

    id: str
    title: str
    subtitle: str
    description: str
    category: str
    module_type: ModuleType = "simulator"
    status: ModuleStatus = "active"
    icon: str = "compass"
    tags: list[str] = field(default_factory=list)


class BaseSimulator(ABC):
    """Abstract base class for all FinDependence pluggable modules."""

    metadata: SimulatorMetadata

    @abstractmethod
    def run(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute the module with validated parameters and return structured output."""

    @abstractmethod
    def get_default_params(self) -> dict[str, Any]:
        """Return default input parameters for UI initialization."""


class SimulatorRegistry:
    """
    Central lifecycle registry for all functions/modules in FinDependence India.

    Makes adding a new module or retiring an unused module a single-line operation:
    - `registry.register(MyModule())`
    - `registry.retire("old_module_id")`
    - `registry.activate("module_id")`
    """

    def __init__(self) -> None:
        self._modules: dict[str, BaseSimulator] = {}
        self._planned_metadata: dict[str, SimulatorMetadata] = {}
        self._status_overrides: dict[str, ModuleStatus] = {}

    def register(self, module: BaseSimulator) -> None:
        """Register an executable module instance."""
        self._modules[module.metadata.id] = module
        self._status_overrides[module.metadata.id] = module.metadata.status

    def register_planned(self, metadata: SimulatorMetadata) -> None:
        """Register metadata for an upcoming/planned module."""
        self._planned_metadata[metadata.id] = metadata
        self._status_overrides[metadata.id] = metadata.status

    def retire(self, module_id: str) -> None:
        """Retire a module so it is hidden from active navigation and cannot be invoked."""
        if module_id not in self._modules and module_id not in self._planned_metadata:
            raise KeyError(f"Module '{module_id}' is not registered.")
        self._status_overrides[module_id] = "retired"

    def activate(self, module_id: str) -> None:
        """Re-activate a previously retired module."""
        if module_id not in self._modules and module_id not in self._planned_metadata:
            raise KeyError(f"Module '{module_id}' is not registered.")
        self._status_overrides[module_id] = "active"

    def get_status(self, module_id: str) -> ModuleStatus:
        """Return the current lifecycle status of a module."""
        if module_id in self._status_overrides:
            return self._status_overrides[module_id]
        if module_id in self._modules:
            return self._modules[module_id].metadata.status
        if module_id in self._planned_metadata:
            return self._planned_metadata[module_id].status
        raise KeyError(f"Module '{module_id}' is not registered.")

    def get(self, module_id: str) -> BaseSimulator:
        """Retrieve an active executable module by ID."""
        if module_id not in self._modules:
            raise KeyError(f"Simulator '{module_id}' is not registered or not yet active.")
        if self.get_status(module_id) == "retired":
            raise KeyError(f"Module '{module_id}' has been retired and is no longer active.")
        return self._modules[module_id]

    def list_active(self) -> list[dict[str, Any]]:
        """List only currently active modules for UI navigation."""
        return [m for m in self.list_all(include_retired=False) if m["status"] == "active"]

    def list_all(self, include_retired: bool = False) -> list[dict[str, Any]]:
        """List registered modules with metadata, current status, and default params."""
        items: list[dict[str, Any]] = []
        for mod_id, mod in self._modules.items():
            effective_status = self.get_status(mod_id)
            if not include_retired and effective_status == "retired":
                continue
            m = replace(mod.metadata, status=effective_status)
            items.append(
                {
                    "id": m.id,
                    "title": m.title,
                    "subtitle": m.subtitle,
                    "description": m.description,
                    "category": m.category,
                    "module_type": m.module_type,
                    "status": m.status,
                    "icon": m.icon,
                    "tags": m.tags,
                    "default_params": mod.get_default_params(),
                }
            )
        for mod_id, m_orig in self._planned_metadata.items():
            if mod_id not in self._modules:
                effective_status = self.get_status(mod_id)
                if not include_retired and effective_status == "retired":
                    continue
                m = replace(m_orig, status=effective_status)
                items.append(
                    {
                        "id": m.id,
                        "title": m.title,
                        "subtitle": m.subtitle,
                        "description": m.description,
                        "category": m.category,
                        "module_type": m.module_type,
                        "status": m.status,
                        "icon": m.icon,
                        "tags": m.tags,
                        "default_params": None,
                    }
                )
        return items


# Singleton registry used across the application
registry = SimulatorRegistry()


def generate_monte_carlo_paths(
    horizon_years: int,
    num_simulations: int = 1000,
    sampling_method: SamplingMethod = "iid_bootstrap",
    base_inflation_override: float | None = 0.06,
    use_historical_inflation_volatility: bool = True,
    block_size: int = 3,
    seed: int | None = None,
) -> dict[str, np.ndarray | int]:
    """
    Generate random multi-asset return paths by sampling from Indian market history (1991-2025).
    """
    actual_seed = seed if seed is not None else secrets.randbits(31)
    rng = np.random.default_rng(actual_seed)
    hist = get_historical_arrays()
    years_arr = hist["years"]
    n_hist = len(years_arr)

    hist_matrix = np.column_stack(
        [hist["equity"], hist["fixed_income"], hist["property"], hist["cpi"]]
    )

    if sampling_method == "parametric_correlated":
        mean_vec = np.mean(hist_matrix, axis=0)
        cov_mat = np.cov(hist_matrix, rowvar=False)
        samples = rng.multivariate_normal(
            mean=mean_vec, cov=cov_mat, size=(num_simulations, horizon_years)
        )
        eq_paths = np.clip(samples[:, :, 0], -0.75, 1.25)
        fi_paths = np.clip(samples[:, :, 1], -0.10, 0.25)
        prop_paths = np.clip(samples[:, :, 2], -0.25, 0.40)
        cpi_paths = np.clip(samples[:, :, 3], 0.005, 0.20)
        sampled_years = np.zeros((num_simulations, horizon_years), dtype=np.int32)
    elif sampling_method == "block_bootstrap":
        n_blocks = int(np.ceil(horizon_years / max(1, block_size)))
        start_indices = rng.integers(0, n_hist, size=(num_simulations, n_blocks))
        offsets = np.arange(max(1, block_size))
        full_indices = (start_indices[:, :, None] + offsets[None, None, :]) % n_hist
        flat_indices = full_indices.reshape(num_simulations, -1)[:, :horizon_years]
        sampled = hist_matrix[flat_indices]
        eq_paths = sampled[:, :, 0]
        fi_paths = sampled[:, :, 1]
        prop_paths = sampled[:, :, 2]
        cpi_paths = sampled[:, :, 3]
        sampled_years = years_arr[flat_indices]
    else:
        idx = rng.integers(0, n_hist, size=(num_simulations, horizon_years))
        sampled = hist_matrix[idx]
        eq_paths = sampled[:, :, 0]
        fi_paths = sampled[:, :, 1]
        prop_paths = sampled[:, :, 2]
        cpi_paths = sampled[:, :, 3]
        sampled_years = years_arr[idx]

    if base_inflation_override is not None:
        if use_historical_inflation_volatility:
            hist_cpi_mean = float(np.mean(hist["cpi"]))
            cpi_paths = np.clip(cpi_paths - hist_cpi_mean + base_inflation_override, 0.0, 0.22)
        else:
            cpi_paths = np.full((num_simulations, horizon_years), base_inflation_override, dtype=np.float64)

    return {
        "seed_used": int(actual_seed),
        "sampled_years": sampled_years,
        "equity": eq_paths,
        "fixed_income": fi_paths,
        "property": prop_paths,
        "cpi": cpi_paths,
    }


def generate_historical_backtest_paths(
    horizon_years: int,
    base_inflation_override: float | None = None,
) -> dict[str, Any]:
    """
    Generate historical rolling window paths starting at each year in Indian market history (1991-2025).
    """
    hist = get_historical_arrays()
    years = hist["years"]
    n_hist = len(years)

    eq_paths = np.zeros((n_hist, horizon_years), dtype=np.float64)
    fi_paths = np.zeros((n_hist, horizon_years), dtype=np.float64)
    prop_paths = np.zeros((n_hist, horizon_years), dtype=np.float64)
    cpi_paths = np.zeros((n_hist, horizon_years), dtype=np.float64)

    for start_idx in range(n_hist):
        seq_indices = (start_idx + np.arange(horizon_years)) % n_hist
        eq_paths[start_idx] = hist["equity"][seq_indices]
        fi_paths[start_idx] = hist["fixed_income"][seq_indices]
        prop_paths[start_idx] = hist["property"][seq_indices]
        if base_inflation_override is not None:
            hist_cpi_mean = float(np.mean(hist["cpi"]))
            cpi_paths[start_idx] = np.clip(
                hist["cpi"][seq_indices] - hist_cpi_mean + base_inflation_override, 0.0, 0.22
            )
        else:
            cpi_paths[start_idx] = hist["cpi"][seq_indices]

    return {
        "start_years": [int(y) for y in years],
        "equity": eq_paths,
        "fixed_income": fi_paths,
        "property": prop_paths,
        "cpi": cpi_paths,
    }
