/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'; // Added useRef import just in case it was missed, though likely already present
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidStatefulModelInfo, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames, subTextMdOfProviderName } from '../../../../common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButtonBgDarken, VoidCustomDropdownBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useIsOptedOut, useRefreshModelListener, useRefreshModelState, useSettingsState, useAgentsServiceState, usePolicyServiceState, useModelRouterServiceState, useSkillsState, useMemoryState, useOrchestrationRunsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, Asterisk, Plus } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import Severity from '../../../../../../../base/common/severity.js'
import { getModelCapabilities, modelOverrideKeys, ModelOverrides } from '../../../../common/modelCapabilities.js';
import { RouterCategory } from '../../../../common/modelRouter/modelRouterService.js';
import { PolicyRequestKind, UserPolicyRuleInput } from '../../../../common/policy/policyService.js';
import { TransferEditorType, TransferFilesInfo } from '../../../extensionTransferTypes.js';
import { MCPServer } from '../../../../common/mcpServiceTypes.js';
import { useMCPServiceState } from '../util/services.js';
import { OPT_OUT_KEY } from '../../../../common/storageKeys.js';
import { StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';

type Tab =
	| 'models'
	| 'localProviders'
	| 'providers'
	| 'featureOptions'
	| 'mcp'
	| 'general'
	| 'all';


const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {

	return <div className='flex items-center text-void-fg-3 px-3 py-0.5 rounded-sm overflow-hidden gap-2'>
		{leftButton ? leftButton : null}
		<span>
			{text}
		</span>
	</div>
}

// models
const RefreshModelButton = ({ providerName }: { providerName: RefreshableProviderName }) => {

	const refreshModelState = useRefreshModelState()

	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')
	const metricsService = accessor.get('IMetricsService')

	const [justFinished, setJustFinished] = useState<null | 'finished' | 'error'>(null)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (!(state === 'finished' || state === 'error')) return
			// now we know we just entered 'finished' state for this providerName
			setJustFinished(state)
			const tid = setTimeout(() => { setJustFinished(null) }, 2000)
			return () => clearTimeout(tid)
		}, [providerName])
	)

	const { state } = refreshModelState[providerName]

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <ButtonLeftTextRightOption

		leftButton={
			<button
				className='flex items-center'
				disabled={state === 'refreshing' || justFinished !== null}
				onClick={() => {
					refreshModelService.startRefreshingModels(providerName, { enableProviderOnSuccess: false, doNotFire: false })
					metricsService.capture('Click', { providerName, action: 'Refresh Models' })
				}}
			>
				{justFinished === 'finished' ? <Check className='stroke-green-500 size-3' />
					: justFinished === 'error' ? <X className='stroke-red-500 size-3' />
						: state === 'refreshing' ? <Loader2 className='size-3 animate-spin' />
							: <RefreshCw className='size-3' />}
			</button>
		}

		text={justFinished === 'finished' ? `${providerTitle} Models are up-to-date!`
			: justFinished === 'error' ? `${providerTitle} not found!`
				: `Manually refresh ${providerTitle} models.`}
	/>
}

const RefreshableModels = () => {
	const settingsState = useSettingsState()


	const buttons = refreshableProviderNames.map(providerName => {
		if (!settingsState.settingsOfProvider[providerName]._didFillInProviderSettings) return null
		return <RefreshModelButton key={providerName} providerName={providerName} />
	})

	return <>
		{buttons}
	</>

}



export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);

	useEffect(() => {
		const startTime = performance.now();
		const duration = 500; // 500ms animation

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);

			setDashOffset(newOffset);

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}


const AddButton = ({ disabled, text = 'Add', ...props }: { disabled?: boolean, text?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		className={`bg-[#0e70c0] px-3 py-1 text-white rounded-sm ${!disabled ? 'hover:bg-[#1177cb] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-opacity-70'}`}
		{...props}
	>{text}</button>

}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);
	return (
		<div ref={ref} className={`inline-block`}>
			<VoidButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true);
				} else {
					onConfirm();
					setConfirm(false);
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</VoidButtonBgDarken>
		</div>
	);
};

// ---------------- Simplified Model Settings Dialog ------------------

// keys of ModelOverrides we allow the user to override



// This new dialog replaces the verbose UI with a single JSON override box.
const SimpleModelSettingsDialog = ({
	isOpen,
	onClose,
	modelInfo,
}: {
	isOpen: boolean;
	onClose: () => void;
	modelInfo: { modelName: string; providerName: ProviderName; type: 'autodetected' | 'custom' | 'default' } | null;
}) => {
	if (!isOpen || !modelInfo) return null;

	const { modelName, providerName, type } = modelInfo;
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const mouseDownInsideModal = useRef(false); // Ref to track mousedown origin
	const settingsStateService = accessor.get('IVoidSettingsService')

	// current overrides and defaults
	const defaultModelCapabilities = getModelCapabilities(providerName, modelName, undefined);
	const currentOverrides = settingsState.overridesOfModel?.[providerName]?.[modelName] ?? undefined;
	const { recognizedModelName, isUnrecognizedModel } = defaultModelCapabilities

	// Create the placeholder with the default values for allowed keys
	const partialDefaults: Partial<ModelOverrides> = {};
	for (const k of modelOverrideKeys) { if (defaultModelCapabilities[k]) partialDefaults[k] = defaultModelCapabilities[k] as any; }
	const placeholder = JSON.stringify(partialDefaults, null, 2);

	const [overrideEnabled, setOverrideEnabled] = useState<boolean>(() => !!currentOverrides);

	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

	// reset when dialog toggles
	useEffect(() => {
		if (!isOpen) return;
		const cur = settingsState.overridesOfModel?.[providerName]?.[modelName];
		setOverrideEnabled(!!cur);
		setErrorMsg(null);
	}, [isOpen, providerName, modelName, settingsState.overridesOfModel, placeholder]);

	const onSave = async () => {
		// if disabled override, reset overrides
		if (!overrideEnabled) {
			await settingsStateService.setOverridesOfModel(providerName, modelName, undefined);
			onClose();
			return;
		}

		// enabled overrides
		// parse json
		let parsedInput: Record<string, unknown>

		if (textAreaRef.current?.value) {
			try {
				parsedInput = JSON.parse(textAreaRef.current.value);
			} catch (e) {
				setErrorMsg('Invalid JSON');
				return;
			}
		} else {
			setErrorMsg('Invalid JSON');
			return;
		}

		// only keep allowed keys
		const cleaned: Partial<ModelOverrides> = {};
		for (const k of modelOverrideKeys) {
			if (!(k in parsedInput)) continue
			const isEmpty = parsedInput[k] === '' || parsedInput[k] === null || parsedInput[k] === undefined;
			if (!isEmpty) {
				cleaned[k] = parsedInput[k] as any;
			}
		}
		await settingsStateService.setOverridesOfModel(providerName, modelName, cleaned);
		onClose();
	};

	const sourcecodeOverridesLink = `https://github.com/voideditor/void/blob/2e5ecb291d33afbe4565921664fb7e183189c1c5/src/vs/workbench/contrib/void/common/modelCapabilities.ts#L146-L172`

	return (
		<div // Backdrop
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
			onMouseDown={() => {
				mouseDownInsideModal.current = false;
			}}
			onMouseUp={() => {
				if (!mouseDownInsideModal.current) {
					onClose();
				}
				mouseDownInsideModal.current = false;
			}}
		>
			{/* MODAL */}
			<div
				className="bg-void-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh]"
				onClick={(e) => e.stopPropagation()} // Keep stopping propagation for normal clicks inside
				onMouseDown={(e) => {
					mouseDownInsideModal.current = true;
					e.stopPropagation();
				}}
			>
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-medium">
						Change Defaults for {modelName} ({displayInfoOfProviderName(providerName).title})
					</h3>
					<button
						onClick={onClose}
						className="text-void-fg-3 hover:text-void-fg-1"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* Display model recognition status */}
				<div className="text-sm text-void-fg-3 mb-4">
					{type === 'default' ? `${modelName} comes packaged with Vader, so you shouldn't need to change these settings.`
						: isUnrecognizedModel
							? `Model not recognized by Vader.`
							: `Vader recognizes ${modelName} ("${recognizedModelName}").`}
				</div>


				{/* override toggle */}
				<div className="flex items-center gap-2 mb-4">
					<VoidSwitch size='xs' value={overrideEnabled} onChange={setOverrideEnabled} />
					<span className="text-void-fg-3 text-sm">Override model defaults</span>
				</div>

				{/* Informational link */}
				{overrideEnabled && <div className="text-sm text-void-fg-3 mb-4">
					<ChatMarkdownRender string={`See the [sourcecode](${sourcecodeOverridesLink}) for a reference on how to set this JSON (advanced).`} chatMessageLocation={undefined} />
				</div>}

				<textarea
					key={overrideEnabled + ''}
					ref={textAreaRef}
					className={`w-full min-h-[200px] p-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-sm ${!overrideEnabled ? 'text-void-fg-3' : ''}`}
					defaultValue={overrideEnabled && currentOverrides ? JSON.stringify(currentOverrides, null, 2) : placeholder}
					placeholder={placeholder}
					readOnly={!overrideEnabled}
				/>
				{errorMsg && (
					<div className="text-red-500 mt-2 text-sm">{errorMsg}</div>
				)}


				<div className="flex justify-end gap-2 mt-4">
					<VoidButtonBgDarken onClick={onClose} className="px-3 py-1">
						Cancel
					</VoidButtonBgDarken>
					<VoidButtonBgDarken
						onClick={onSave}
						className="px-3 py-1 bg-[#0e70c0] text-white"
					>
						Save
					</VoidButtonBgDarken>
				</div>
			</div>
		</div>
	);
};




export const ModelDump = ({ filteredProviders }: { filteredProviders?: ProviderName[] }) => {
	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	// State to track which model's settings dialog is open
	const [openSettingsModel, setOpenSettingsModel] = useState<{
		modelName: string,
		providerName: ProviderName,
		type: 'autodetected' | 'custom' | 'default'
	} | null>(null);

	// States for add model functionality
	const [isAddModelOpen, setIsAddModelOpen] = useState(false);
	const [showCheckmark, setShowCheckmark] = useState(false);
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName | null>(null);
	const [modelName, setModelName] = useState<string>('');
	const [errorString, setErrorString] = useState('');

	// a dump of all the enabled providers' models
	const modelDump: (VoidStatefulModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []

	// Use either filtered providers or all providers
	const providersToShow = filteredProviders || providerNames;

	for (let providerName of providersToShow) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		// if (!providerSettings.enabled) continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })))
	}

	// sort by hidden
	modelDump.sort((a, b) => {
		return Number(b.providerEnabled) - Number(a.providerEnabled)
	})

	// Add model handler
	const handleAddModel = () => {
		if (!userChosenProviderName) {
			setErrorString('Please select a provider.');
			return;
		}
		if (!modelName) {
			setErrorString('Please enter a model name.');
			return;
		}

		// Check if model already exists
		if (settingsState.settingsOfProvider[userChosenProviderName].models.find(m => m.modelName === modelName)) {
			setErrorString(`This model already exists.`);
			return;
		}

		settingsStateService.addModel(userChosenProviderName, modelName);
		setShowCheckmark(true);
		setTimeout(() => {
			setShowCheckmark(false);
			setIsAddModelOpen(false);
			setUserChosenProviderName(null);
			setModelName('');
		}, 1500);
		setErrorString('');
	};

	return <div className=''>
		{modelDump.map((m, i) => {
			const { isHidden, type, modelName, providerName, providerEnabled } = m

			const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName

			const providerTitle = displayInfoOfProviderName(providerName).title

			const disabled = !providerEnabled
			const value = disabled ? false : !isHidden

			const tooltipName = (
				disabled ? `Add ${providerTitle} to enable`
					: value === true ? 'Show in Dropdown'
						: 'Hide from Dropdown'
			)


			const detailAboutModel = type === 'autodetected' ?
				<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='void-tooltip' data-tooltip-place='right' data-tooltip-content='Detected locally' />
				: type === 'custom' ?
					<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='void-tooltip' data-tooltip-place='right' data-tooltip-content='Custom model' />
					: undefined

			const hasOverrides = !!settingsState.overridesOfModel?.[providerName]?.[modelName]

			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group
				`}
			>
				{/* left part is width:full */}
				<div className={`flex flex-grow items-center gap-4`}>
					<span className='w-full max-w-32'>{isNewProviderName ? providerTitle : ''}</span>
					<span className='w-fit max-w-[400px] truncate'>{modelName}</span>
				</div>

				{/* right part is anything that fits */}
				<div className="flex items-center gap-2 w-fit">

					{/* Advanced Settings button (gear). Hide entirely when provider/model disabled. */}
					{disabled ? null : (
						<div className="w-5 flex items-center justify-center">
							<button
								onClick={() => { setOpenSettingsModel({ modelName, providerName, type }) }}
								data-tooltip-id='void-tooltip'
								data-tooltip-place='right'
								data-tooltip-content='Advanced Settings'
								className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
							>
								<Plus size={12} className="text-void-fg-3 opacity-50" />
							</button>
						</div>
					)}

					{/* Blue star */}
					{detailAboutModel}


					{/* Switch */}
					<VoidSwitch
						value={value}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName); }}
						disabled={disabled}
						size='sm'

						data-tooltip-id='void-tooltip'
						data-tooltip-place='right'
						data-tooltip-content={tooltipName}
					/>

					{/* X button */}
					<div className={`w-5 flex items-center justify-center`}>
						{type === 'default' || type === 'autodetected' ? null : <button
							onClick={() => { settingsStateService.deleteModel(providerName, modelName); }}
							data-tooltip-id='void-tooltip'
							data-tooltip-place='right'
							data-tooltip-content='Delete'
							className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
						>
							<X size={12} className="text-void-fg-3 opacity-50" />
						</button>}
					</div>
				</div>
			</div>
		})}

		{/* Add Model Section */}
		{showCheckmark ? (
			<div className="mt-4">
				<AnimatedCheckmarkButton text='Added' className="bg-[#0e70c0] text-white px-3 py-1 rounded-sm" />
			</div>
		) : isAddModelOpen ? (
			<div className="mt-4">
				<form className="flex items-center gap-2">

					{/* Provider dropdown */}
					<ErrorBoundary>
						<VoidCustomDropdownBox
							options={providersToShow}
							selectedOption={userChosenProviderName}
							onChangeOption={(pn) => setUserChosenProviderName(pn)}
							getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionsEqual={(a, b) => a === b}
							className="max-w-32 mx-2 w-full resize-none bg-void-bg-1 text-void-fg-1 placeholder:text-void-fg-3 border border-void-border-2 focus:border-void-border-1 py-1 px-2 rounded"
							arrowTouchesText={false}
						/>
					</ErrorBoundary>

					{/* Model name input */}
					<ErrorBoundary>
						<VoidSimpleInputBox
							value={modelName}
							compact={true}
							onChangeValue={setModelName}
							placeholder='Model Name'
							className='max-w-32'
						/>
					</ErrorBoundary>

					{/* Add button */}
					<ErrorBoundary>
						<AddButton
							type='button'
							disabled={!modelName || !userChosenProviderName}
							onClick={handleAddModel}
						/>
					</ErrorBoundary>

					{/* X button to cancel */}
					<button
						type="button"
						onClick={() => {
							setIsAddModelOpen(false);
							setErrorString('');
							setModelName('');
							setUserChosenProviderName(null);
						}}
						className='text-void-fg-4'
					>
						<X className='size-4' />
					</button>
				</form>

				{errorString && (
					<div className='text-red-500 truncate whitespace-nowrap mt-1'>
						{errorString}
					</div>
				)}
			</div>
		) : (
			<div
				className="text-void-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer mt-4"
				onClick={() => setIsAddModelOpen(true)}
			>
				<div className="flex items-center gap-1">
					<Plus size={16} />
					<span>Add a model</span>
				</div>
			</div>
		)}

		{/* Model Settings Dialog */}
		<SimpleModelSettingsDialog
			isOpen={openSettingsModel !== null}
			onClose={() => setOpenSettingsModel(null)}
			modelInfo={openSettingsModel}
		/>
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName, subTextMd }: { providerName: ProviderName, settingName: SettingName, subTextMd: React.ReactNode }) => {

	const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	const settingValue = settingsState.settingsOfProvider[providerName][settingName] as string // this should always be a string in this component
	if (typeof settingValue !== 'string') {
		console.log('Error: Provider setting had a non-string value.')
		return
	}

	// Create a stable callback reference using useCallback with proper dependencies
	const handleChangeValue = useCallback((newVal: string) => {
		voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
	}, [voidSettingsService, providerName, settingName]);

	return <ErrorBoundary>
		<div className='my-1'>
			<VoidSimpleInputBox
				value={settingValue}
				onChangeValue={handleChangeValue}
				placeholder={`${settingTitle} (${placeholder})`}
				passwordBlur={isPasswordField}
				compact={true}
			/>
			{!subTextMd ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				{subTextMd}
			</div>}
		</div>
	</ErrorBoundary>
}

// const OldSettingsForProvider = ({ providerName, showProviderTitle }: { providerName: ProviderName, showProviderTitle: boolean }) => {
// 	const voidSettingsState = useSettingsState()

// 	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

// 	// const accessor = useAccessor()
// 	// const voidSettingsService = accessor.get('IVoidSettingsService')

// 	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
// 	const settingNames = customSettingNamesOfProvider(providerName)

// 	const { title: providerTitle } = displayInfoOfProviderName(providerName)

// 	return <div className='my-4'>

// 		<div className='flex items-center w-full gap-4'>
// 			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

// 			{/* enable provider switch */}
// 			{/* <VoidSwitch
// 				value={!!enabled}
// 				onChange={
// 					useCallback(() => {
// 						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
// 						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
// 					}, [voidSettingsService, providerName])}
// 				size='sm+'
// 			/> */}
// 		</div>

// 		<div className='px-0'>
// 			{/* settings besides models (e.g. api key) */}
// 			{settingNames.map((settingName, i) => {
// 				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
// 			})}

// 			{needsModel ?
// 				providerName === 'ollama' ?
// 					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
// 					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
// 				: null}
// 		</div>
// 	</div >
// }


export const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
	const voidSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

	// const accessor = useAccessor()
	// const voidSettingsService = accessor.get('IVoidSettingsService')

	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div>

		<div className='flex items-center w-full gap-4'>
			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

			{/* enable provider switch */}
			{/* <VoidSwitch
				value={!!enabled}
				onChange={
					useCallback(() => {
						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
					}, [voidSettingsService, providerName])}
				size='sm+'
			/> */}
		</div>

		<div className='px-0'>
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {

				return <ProviderSetting
					key={settingName}
					providerName={providerName}
					settingName={settingName}
					subTextMd={i !== settingNames.length - 1 ? null
						: <ChatMarkdownRender string={subTextMdOfProviderName(providerName)} chatMessageLocation={undefined} />}
				/>
			})}

			{showProviderSuggestions && needsModel ?
				providerName === 'ollama' ?
					<WarningBox className="pl-2 mb-4" text={`Please install an Ollama model. We'll auto-detect it.`} />
					: <WarningBox className="pl-2 mb-4" text={`Please add a model for ${providerTitle} (Models section).`} />
				: null}
		</div>
	</div >
}


// Vader addition: manage permanent agents and the policy engine's permission mode.
// See common/agents/agentsService.ts and common/policy/policyService.ts.
export const AgentsAndPolicySection = () => {
	const accessor = useAccessor()
	const agentsService = accessor.get('IAgentsService')
	const policyService = accessor.get('IPolicyService')
	const chatThreadService = accessor.get('IChatThreadService')

	const agentsState = useAgentsServiceState()
	const policyState = usePolicyServiceState()

	const [showNewAgentForm, setShowNewAgentForm] = useState(false)
	const [newName, setNewName] = useState('')
	const [newDescription, setNewDescription] = useState('')
	const [newInstructions, setNewInstructions] = useState('')

	const [showNewRuleForm, setShowNewRuleForm] = useState(false)
	const [newRuleKind, setNewRuleKind] = useState<PolicyRequestKind>('terminal-command')
	const [newRuleEffect, setNewRuleEffect] = useState<'deny' | 'ask'>('ask')
	const [newRuleDescription, setNewRuleDescription] = useState('')
	const [newRulePattern, setNewRulePattern] = useState('')

	const currentThread = chatThreadService.getCurrentThread()
	const customRules = policyService.getAllRules().filter(r => !r.builtIn)

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Agents & Permissions</h2>
		<h4 className={`text-void-fg-3 mb-4`}>
			Permanent agents are named identities with their own instructions, model, and tool/file restrictions that persist across sessions. The permission mode below controls how much the policy engine lets an agent do without asking first - even in Autonomous mode, a small set of hard rules (destructive commands, credential files) can never be bypassed.
		</h4>

		<div className='my-4'>
			<div className='text-void-fg-3 text-sm mb-1'>Permission mode</div>
			<div className='flex gap-x-2'>
				{(['safe', 'balanced', 'autonomous'] as const).map(mode => (
					<VoidButtonBgDarken
						key={mode}
						className={`px-3 py-1 capitalize ${policyState.mode === mode ? 'ring-1 ring-void-fg-3' : ''}`}
						onClick={() => policyService.setMode(mode)}
					>
						{mode}
					</VoidButtonBgDarken>
				))}
			</div>
		</div>

		<div className='my-4'>
			<div className='text-void-fg-3 text-sm mb-2'>Custom policy rules ({customRules.length})</div>
			<div className='text-void-fg-3 text-xs italic mb-2'>Hard rules beyond the built-in ones below - e.g. "ask before any MCP tool call" or "deny terminal commands matching /rm -rf/". These are evaluated the same way as built-in rules: before any approval prompt, regardless of auto-approve settings.</div>
			<div className='flex flex-col gap-y-2'>
				{customRules.map(rule => (
					<div key={rule.id} className='border border-void-border-3 rounded p-2 flex items-center justify-between'>
						<div>
							<span className={`text-xs uppercase mr-2 ${rule.effect === 'deny' ? 'text-red-500' : 'text-void-fg-3'}`}>{rule.effect}</span>
							<span className='text-xs'>{rule.description}</span>
						</div>
						<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => policyService.removeCustomRule(rule.id)}>Remove</VoidButtonBgDarken>
					</div>
				))}
			</div>
			<div className='mt-2'>
				{!showNewRuleForm ? (
					<VoidButtonBgDarken className='px-3 py-1' onClick={() => setShowNewRuleForm(true)}>+ New Rule</VoidButtonBgDarken>
				) : (
					<div className='flex flex-col gap-y-2 border border-void-border-3 rounded p-3'>
						<div className='flex gap-x-2'>
							<VoidCustomDropdownBox
								className='text-xs bg-void-bg-1 border border-void-border-2 rounded py-0.5 px-1'
								options={['file-write', 'file-delete', 'terminal-command', 'mcp-tool'] as PolicyRequestKind[]}
								selectedOption={newRuleKind}
								onChangeOption={setNewRuleKind}
								getOptionDisplayName={k => k}
								getOptionDropdownName={k => k}
								getOptionDropdownDetail={() => ''}
								getOptionsEqual={(a, b) => a === b}
							/>
							<VoidCustomDropdownBox
								className='text-xs bg-void-bg-1 border border-void-border-2 rounded py-0.5 px-1'
								options={['ask', 'deny'] as const}
								selectedOption={newRuleEffect}
								onChangeOption={setNewRuleEffect}
								getOptionDisplayName={k => k}
								getOptionDropdownName={k => k}
								getOptionDropdownDetail={() => ''}
								getOptionsEqual={(a, b) => a === b}
							/>
						</div>
						<VoidSimpleInputBox value={newRuleDescription} onChangeValue={setNewRuleDescription} placeholder='Description shown when this rule fires' />
						<VoidSimpleInputBox value={newRulePattern} onChangeValue={setNewRulePattern}
							placeholder={newRuleKind === 'file-write' || newRuleKind === 'file-delete' ? 'Glob pattern(s), comma-separated (e.g. **/.env*)'
								: newRuleKind === 'terminal-command' ? 'Regex pattern(s), comma-separated (e.g. rm -rf)'
									: 'MCP server name regex(es), comma-separated - leave empty to match every MCP server'} />
						<div className='flex gap-x-2'>
							<VoidButtonBgDarken
								className='px-3 py-1'
								onClick={() => {
									if (!newRuleDescription.trim()) return
									const patterns = newRulePattern.split(',').map(s => s.trim()).filter(Boolean)
									if (patterns.length === 0 && newRuleKind !== 'mcp-tool') return // mcp-tool alone may deliberately have no patterns (matches every server); the others require a discriminator
									const input: UserPolicyRuleInput = {
										description: newRuleDescription.trim(),
										effect: newRuleEffect,
										kinds: [newRuleKind],
										pathGlobs: newRuleKind === 'file-write' || newRuleKind === 'file-delete' ? patterns : undefined,
										commandPatterns: newRuleKind === 'terminal-command' ? patterns : undefined,
										serverNamePatterns: newRuleKind === 'mcp-tool' ? patterns : undefined,
									}
									policyService.addCustomRule(input)
									setNewRuleDescription(''); setNewRulePattern(''); setShowNewRuleForm(false)
								}}
							>Create</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-3 py-1' onClick={() => setShowNewRuleForm(false)}>Cancel</VoidButtonBgDarken>
						</div>
					</div>
				)}
			</div>
		</div>

		<div className='my-4'>
			<div className='text-void-fg-3 text-sm mb-2'>Permanent agents ({agentsState.agents.length})</div>
			{agentsState.agents.length === 0 ? <div className='text-void-fg-3 text-xs italic mb-2'>No permanent agents yet. Create one below, or ask the main agent to create one for a task it does repeatedly.</div> : null}
			<div className='flex flex-col gap-y-2'>
				{agentsState.agents.map(agent => (
					<div key={agent.id} className='border border-void-border-3 rounded p-2 flex flex-col gap-y-1'>
						<div className='flex items-center justify-between'>
							<span className='font-medium'>{agent.name}</span>
							<div className='flex gap-x-1'>
								<VoidButtonBgDarken
									className={`px-2 py-0.5 text-xs ${currentThread.agentId === agent.id ? 'ring-1 ring-void-fg-3' : ''}`}
									onClick={() => chatThreadService.setThreadAgentId(currentThread.id, currentThread.agentId === agent.id ? null : agent.id)}
								>
									{currentThread.agentId === agent.id ? 'In use (click to unset)' : 'Use in current chat'}
								</VoidButtonBgDarken>
								<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => agentsService.deleteAgent(agent.id)}>
									Delete
								</VoidButtonBgDarken>
							</div>
						</div>
						<span className='text-void-fg-3 text-xs'>{agent.description}</span>
						{agent.createdBy === 'main-agent' ? <span className='text-void-fg-3 text-xs italic'>Created by the main agent</span> : null}
					</div>
				))}
			</div>
		</div>

		<div className='my-4'>
			{!showNewAgentForm ? (
				<VoidButtonBgDarken className='px-3 py-1' onClick={() => setShowNewAgentForm(true)}>+ New Agent</VoidButtonBgDarken>
			) : (
				<div className='flex flex-col gap-y-2 border border-void-border-3 rounded p-3'>
					<VoidSimpleInputBox value={newName} onChangeValue={setNewName} placeholder='Name (e.g. "Vulkan Specialist")' />
					<VoidSimpleInputBox value={newDescription} onChangeValue={setNewDescription} placeholder='One-sentence description' />
					<VoidInputBox2 initValue='' multiline onChangeText={setNewInstructions} placeholder='Instructions this agent should always follow' />
					<div className='flex gap-x-2'>
						<VoidButtonBgDarken
							className='px-3 py-1'
							onClick={() => {
								if (!newName.trim() || !newInstructions.trim()) return
								agentsService.createAgent({ name: newName.trim(), description: newDescription.trim(), instructions: newInstructions.trim() }, 'user')
								setNewName(''); setNewDescription(''); setNewInstructions(''); setShowNewAgentForm(false)
							}}
						>Create</VoidButtonBgDarken>
						<VoidButtonBgDarken className='px-3 py-1' onClick={() => setShowNewAgentForm(false)}>Cancel</VoidButtonBgDarken>
					</div>
				</div>
			)}
		</div>
	</div>
}


const ROUTER_CATEGORIES: { category: RouterCategory, label: string, desc: string }[] = [
	{ category: 'subagent', label: 'Subagent delegation', desc: 'Tasks handed off via delegate_subagent_task with no agent-pinned model.' },
	{ category: 'research', label: 'Research', desc: 'Read-only, information-gathering subagent work.' },
	{ category: 'browser', label: 'Browser automation', desc: 'Turns that primarily drive the browser tool.' },
	{ category: 'summarization', label: 'Summarization', desc: 'Context compaction\'s own summarization calls.' },
	{ category: 'verification', label: 'Verification', desc: 'The independent verification pass.' },
]

const DEFAULT_ROUTER_OPTION = '(default: Chat model)'

// Vader addition: AUTO/MANUAL Model Router. See common/modelRouter/.
export const ModelRouterSection = () => {
	const accessor = useAccessor()
	const modelRouterService = accessor.get('IModelRouterService')
	const routerState = useModelRouterServiceState()
	useSettingsState() // re-render when provider settings change, since that changes what's "configured"

	const configuredModels = modelRouterService.listConfiguredModels()

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Model Router</h2>
		<h4 className={`text-void-fg-3 mb-4`}>
			Controls which model handles work that isn't the visible Chat/Autocomplete/Apply/SCM features above - subagent delegation, research, browser automation, and context-compaction summarization. In Auto mode, Vader only ever picks from models you've actually configured below (never a provider with no credentials entered), preferring your Chat model unless another configured model is meaningfully better-suited. In Manual mode, these all use your Chat model unless overridden.
		</h4>

		<div className='my-4'>
			<div className='text-void-fg-3 text-sm mb-1'>Mode</div>
			<div className='flex gap-x-2'>
				{(['auto', 'manual'] as const).map(mode => (
					<VoidButtonBgDarken
						key={mode}
						className={`px-3 py-1 capitalize ${routerState.mode === mode ? 'ring-1 ring-void-fg-3' : ''}`}
						onClick={() => modelRouterService.setMode(mode)}
					>
						{mode}
					</VoidButtonBgDarken>
				))}
			</div>
		</div>

		<div className='my-4'>
			<div className='text-void-fg-3 text-sm mb-2'>Per-category model{routerState.mode === 'manual' ? '' : ' (Manual mode only - Auto mode picks automatically, ignoring these)'}</div>
			{configuredModels.length === 0 ? <div className='text-void-fg-3 text-xs italic'>No models configured yet - add a provider above first.</div> : null}
			<div className='flex flex-col gap-y-1'>
				{ROUTER_CATEGORIES.map(({ category, label, desc }) => {
					const resolved = modelRouterService.resolveModel(category)
					const override = modelRouterService.getCategoryOverride(category)
					const overrideKey = override ? `${override.providerName}/${override.modelName}` : DEFAULT_ROUTER_OPTION
					const options = [DEFAULT_ROUTER_OPTION, ...configuredModels.map(d => `${d.providerName}/${d.modelName}`)]
					return <div key={category} className='flex items-center justify-between text-xs border-b border-void-border-3 py-1 gap-x-2'>
						<div>
							<div className='font-medium'>{label}</div>
							<div className='text-void-fg-3'>{desc}</div>
							<div className='text-void-fg-3'>Currently resolves to: {resolved ? `${resolved.providerName}/${resolved.modelName}` : '(none configured)'}</div>
						</div>
						<VoidCustomDropdownBox
							className='text-xs bg-void-bg-1 border border-void-border-2 rounded py-0.5 px-1 shrink-0'
							options={options}
							selectedOption={overrideKey}
							onChangeOption={(val) => {
								if (val === DEFAULT_ROUTER_OPTION) { modelRouterService.setCategoryOverride(category, null); return }
								const [providerName, modelName] = val.split('/')
								modelRouterService.setCategoryOverride(category, { providerName: providerName as ProviderName, modelName })
							}}
							getOptionDisplayName={k => k}
							getOptionDropdownName={k => k}
							getOptionDropdownDetail={() => ''}
							getOptionsEqual={(a, b) => a === b}
						/>
					</div>
				})}
			</div>
		</div>
	</div>
}


const trustBadgeClass = (trustState: string) =>
	trustState === 'trusted' ? 'text-green-600' : trustState === 'blocked' ? 'text-red-500' : 'text-void-fg-3'

// Vader addition: Skills lifecycle UI - see common/skills/. Installed skills start disabled
// and 'review_required'; this is where a user actually reviews/enables/trusts/removes one -
// without this, install_skill would be a tool with no way to act on what it produced.
export const SkillsSection = () => {
	const accessor = useAccessor()
	const skillService = accessor.get('ISkillService')
	const skills = useSkillsState()

	if (skills.length === 0) return null

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Skills</h2>
		<h4 className={`text-void-fg-3 mb-4`}>
			Skills the main agent discovered (via SkillNet) and installed, or wrote itself. Every skill starts disabled and marked "review_required" - read it before enabling, and especially before marking it Trusted. An update to a skill's source content automatically downgrades a Trusted skill back to review_required, so a silent external change can never keep trusted status without you seeing it again.
		</h4>
		<div className='flex flex-col gap-y-2'>
			{skills.map(skill => (
				<div key={skill.id} className='border border-void-border-3 rounded p-2 flex flex-col gap-y-1'>
					<div className='flex items-center justify-between'>
						<span className='font-medium'>{skill.name}</span>
						<span className={`text-xs capitalize ${trustBadgeClass(skill.trustState)}`}>{skill.trustState.replace('_', ' ')}</span>
					</div>
					<span className='text-void-fg-3 text-xs'>{skill.description}</span>
					<span className='text-void-fg-3 text-xs'>
						Category: {skill.category}
						{skill.requestedCapabilities.terminal || skill.requestedCapabilities.fs || skill.requestedCapabilities.network || skill.requestedCapabilities.mcp ?
							` · Requests: ${[skill.requestedCapabilities.fs && 'filesystem', skill.requestedCapabilities.terminal && 'terminal', skill.requestedCapabilities.network && 'network', skill.requestedCapabilities.mcp && 'MCP'].filter(Boolean).join(', ')}`
							: ''}
					</span>
					<div className='flex gap-x-1 mt-1'>
						<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setEnabled(skill.id, !skill.enabled)}>
							{skill.enabled ? 'Disable' : 'Enable'}
						</VoidButtonBgDarken>
						{skill.trustState !== 'trusted' ?
							<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setTrustState(skill.id, 'trusted')}>Mark Trusted</VoidButtonBgDarken>
							: <VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setTrustState(skill.id, 'review_required')}>Revoke trust</VoidButtonBgDarken>}
						{skill.trustState !== 'blocked' ?
							<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setTrustState(skill.id, 'blocked')}>Block</VoidButtonBgDarken>
							: null}
						<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setPinned(skill.id, !skill.pinned)}>
							{skill.pinned ? 'Unpin' : 'Pin'}
						</VoidButtonBgDarken>
						<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.remove(skill.id)}>Remove</VoidButtonBgDarken>
					</div>
				</div>
			))}
		</div>
	</div>
}


// Vader addition: Memory UI - see common/memory/. Never exposes hidden model
// reasoning/chain-of-thought, only the stored facts/labels a `remember` call actually wrote.
export const MemorySection = () => {
	const accessor = useAccessor()
	const memoryService = accessor.get('IMemoryService')
	const agentsService = accessor.get('IAgentsService')
	const memoryState = useMemoryState()

	if (memoryState.project.length === 0 && memoryState.agent.length === 0) return null

	const agentNameOf = (agentId: string) => agentsService.getAgent(agentId)?.name ?? '(deleted agent)'

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Memory</h2>
		<h4 className={`text-void-fg-3 mb-4`}>
			Facts the main agent (or a permanent agent) chose to remember with the `remember` tool. Project memory is visible to every future thread in this workspace; agent memory is visible only to threads running as that agent.
		</h4>

		{memoryState.project.length > 0 ? <div className='my-3'>
			<div className='flex items-center justify-between mb-2'>
				<div className='text-void-fg-3 text-sm'>Project memory ({memoryState.project.length})</div>
				<VoidButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => memoryService.clearScope('project')}>Clear all</VoidButtonBgDarken>
			</div>
			<div className='flex flex-col gap-y-2'>
				{memoryState.project.map(m => (
					<div key={m.id} className='border border-void-border-3 rounded p-2 flex items-start justify-between gap-x-2'>
						<div>
							<div className='font-medium text-sm'>{m.label}</div>
							<div className='text-void-fg-3 text-xs'>{m.content}</div>
						</div>
						<VoidButtonBgDarken className='px-2 py-0.5 text-xs shrink-0' onClick={() => memoryService.remove(m.id)}>Remove</VoidButtonBgDarken>
					</div>
				))}
			</div>
		</div> : null}

		{memoryState.agent.length > 0 ? <div className='my-3'>
			<div className='text-void-fg-3 text-sm mb-2'>Agent memory ({memoryState.agent.length})</div>
			<div className='flex flex-col gap-y-2'>
				{memoryState.agent.map(m => (
					<div key={m.id} className='border border-void-border-3 rounded p-2 flex items-start justify-between gap-x-2'>
						<div>
							<div className='font-medium text-sm'>{m.label} <span className='text-void-fg-3 font-normal'>({agentNameOf(m.scopeKey)})</span></div>
							<div className='text-void-fg-3 text-xs'>{m.content}</div>
						</div>
						<VoidButtonBgDarken className='px-2 py-0.5 text-xs shrink-0' onClick={() => memoryService.remove(m.id)}>Remove</VoidButtonBgDarken>
					</div>
				))}
			</div>
		</div> : null}
	</div>
}


// Vader addition: Agent Manager - live visibility into parallel agent orchestration runs
// (see common/orchestration/). A first, functional pass built as a Settings section rather
// than a new dedicated workbench view/pane - the live orchestration state this reads
// (IAgentOrchestrationService.runs) is fully real, not a placeholder; a standalone panel
// with its own activity-bar icon is a larger, separate piece of workbench plumbing tracked
// as further UI work, not silently skipped.
// Vader addition, part of the Cline Main Agent Runtime integration - see
// docs/integrations/agent-runtime.md. Shows which runtime (Cline vs. legacy) is currently
// driving Main Agent turns and why, plus both runtimes' health, so the legacy runtime is
// never silently substituted without being visible here.
const RuntimeStatusBlock = () => {
	const accessor = useAccessor()
	const registry = accessor.get('IAgentRuntimeRegistryService')
	const [selection, setSelection] = useState(() => registry.getSelection())

	const healthColor = (status: string) =>
		status === 'initialized' ? 'text-green-600' : status === 'unavailable' || status === 'runtime-error' ? 'text-void-fg-3' : 'text-red-500'

	const runtimeLabel = (kind: 'legacy' | 'cline') => kind === 'cline' ? 'Cline Agent Runtime' : 'Legacy Runtime (Void-derived loop)'

	return <div className='mb-6'>
		<div className='flex items-center justify-between mb-1'>
			<h3 className='text-lg'>Main Agent Runtime</h3>
			<button
				className='text-xs text-void-fg-3 hover:text-void-fg-1 underline'
				onClick={() => { registry.refresh().then(setSelection) }}
			>Refresh</button>
		</div>
		<div className='text-xs text-void-fg-3 mb-2'>
			Active: <span className='text-void-fg-1 font-medium'>{runtimeLabel(selection.active)}</span>
			{selection.reason === 'fallback' ? <span className='text-yellow-600'> (fallback - Cline was not available)</span> : selection.reason === 'explicit' ? ' (explicitly selected)' : ' (default)'}
		</div>
		<div className='flex flex-col gap-y-1'>
			{[selection.clineHealth, selection.legacyHealth].map(h => (
				<div key={h.kind} className='border border-void-border-3 rounded p-2 text-xs'>
					<div className='flex items-center justify-between'>
						<span className='font-medium'>{runtimeLabel(h.kind)}</span>
						<span className={`capitalize ${healthColor(h.status)}`}>{h.status}{h.version ? ` · ${h.version}` : ''}</span>
					</div>
					<div className='text-void-fg-3 mt-1'>{h.detail}</div>
				</div>
			))}
		</div>
	</div>
}

export const AgentManagerSection = () => {
	const runs = useOrchestrationRunsState()

	const statusColor = (status: string) =>
		status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-500' : status === 'running' ? 'text-void-fg-1' : 'text-void-fg-3'

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Agent Manager</h2>
		<RuntimeStatusBlock />
		{runs.length === 0 ? null : <>
		<h4 className={`text-void-fg-3 mb-4`}>Parallel agent runs from delegate_parallel_tasks, most recent first. Each task shows its model/agent, status, and - for worktree-isolated tasks - its merge outcome.</h4>
		<div className='flex flex-col gap-y-4'>
			{runs.slice().reverse().map(run => (
				<div key={run.id} className='border border-void-border-3 rounded p-2'>
					<div className='text-void-fg-3 text-xs mb-2'>Run started {new Date(run.createdAt).toLocaleTimeString()}{run.cancelled ? ' - cancelled' : ''}{run.finishedAt ? ` - finished ${new Date(run.finishedAt).toLocaleTimeString()}` : ' - in progress'}</div>
					<div className='flex flex-col gap-y-1'>
						{run.tasks.map(t => (
							<div key={t.id} className='text-xs border-t border-void-border-3 pt-1'>
								<div className='flex items-center justify-between'>
									<span>{t.task.slice(0, 90)}</span>
									<span className={`capitalize ${statusColor(t.status)}`}>{t.status}</span>
								</div>
								<div className='text-void-fg-3'>
									{t.agentName ? `Agent: ${t.agentName} · ` : ''}
									{t.usesWorktree ? `Worktree${t.branchName ? ` (${t.branchName})` : ''}${t.mergeOutcome ? ` · ${t.mergeOutcome}` : ''}` : 'Direct (no isolation)'}
									{t.changedFilePaths?.length ? ` · ${t.changedFilePaths.length} file(s) changed` : ''}
								</div>
								{t.errorMessage ? <div className='text-red-500'>{t.errorMessage}</div> : null}
							</div>
						))}
					</div>
				</div>
			))}
			</div>
		</>}
	</div>
}


export const VoidProviderSettings = ({ providerNames }: { providerNames: ProviderName[] }) => {
	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} showProviderTitle={true} showProviderSuggestions={true} />
		)}
	</>
}


type TabName = 'models' | 'general'
export const AutoDetectLocalModelsToggle = () => {
	const settingName: GlobalSettingName = 'autoRefreshModels'

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const metricsService = accessor.get('IMetricsService')

	const voidSettingsState = useSettingsState()

	// right now this is just `enabled_autoRefreshModels`
	const enabled = voidSettingsState.globalSettings[settingName]

	return <ButtonLeftTextRightOption
		leftButton={<VoidSwitch
			size='xxs'
			value={enabled}
			onChange={(newVal) => {
				voidSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'Autorefresh Toggle', settingName, enabled: newVal })
			}}
		/>}
		text={`Automatically detect local providers and models (${refreshableProviderNames.map(providerName => displayInfoOfProviderName(providerName).title).join(', ')}).`}
	/>


}

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	return <VoidInputBox2
		className='min-h-[81px] p-3 rounded-sm'
		initValue={voidSettingsState.globalSettings.aiInstructions}
		placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Write new code using Rust if possible. `}
		multiline
		onChangeText={(newText) => {
			voidSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const options = useMemo(() => [true, false], [])

	const onChangeOption = useCallback((newVal: boolean) => {
		voidSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [voidSettingsService])

	return <VoidCustomDropdownBox
		className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={voidSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>

}


export const OllamaSetupInstructions = ({ sayWeAutoDetect }: { sayWeAutoDetect?: boolean }) => {
	return <div className='prose-p:my-0 prose-ol:list-decimal prose-p:py-0 prose-ol:my-0 prose-ol:py-0 prose-span:my-0 prose-span:py-0 text-void-fg-3 text-sm list-decimal select-text'>
		<div className=''><ChatMarkdownRender string={`Ollama Setup Instructions`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`2. Open your terminal.`} chatMessageLocation={undefined} /></div>
		<div
			className='pl-6 flex items-center w-fit'
			data-tooltip-id='void-tooltip-ollama-settings'
		>
			<ChatMarkdownRender string={`3. Run \`ollama pull your_model\` to install a model.`} chatMessageLocation={undefined} />
		</div>
		{sayWeAutoDetect && <div className=' pl-6'><ChatMarkdownRender string={`Vader automatically detects locally running models and enables them.`} chatMessageLocation={undefined} /></div>}
	</div>
}


const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	return <div
		className={`text-void-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		See onboarding screen?
	</div>

}







export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		voidSettingsService.setGlobalSetting('autoApprove', {
			...voidSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [voidSettingsService, metricsService])

	return <>
		<VoidSwitch
			size={size}
			value={voidSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-void-fg-3 text-xs">{desc}</span>
	</>
}



export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')

	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })



	const onClick = async () => {
		if (transferState.type !== 'done') return

		setTransferState({ type: 'loading' })

		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)

		// Even if some files were missing, consider it a success if no actual errors occurred
		const hadError = !!errAcc
		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<VoidButtonBgDarken className={`max-w-48 p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</VoidButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}


// full settings

// MCP Server component
const MCPServerComponent = ({ name, server }: { name: string, server: MCPServer }) => {
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');

	const voidSettings = useSettingsState()
	const isOn = voidSettings.mcpUserStateOfName[name]?.isOn

	const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_')

	return (
		<div className="border border-void-border-2 bg-void-bg-1 py-3 px-4 rounded-sm my-2">
			<div className="flex items-center justify-between">
				{/* Left side - status and name */}
				<div className="flex items-center gap-2">
					{/* Status indicator */}
					<div className={`w-2 h-2 rounded-full
						${server.status === 'success' ? 'bg-green-500'
							: server.status === 'error' ? 'bg-red-500'
								: server.status === 'loading' ? 'bg-yellow-500'
									: server.status === 'offline' ? 'bg-void-fg-3'
										: ''}
					`}></div>

					{/* Server name */}
					<div className="text-sm font-medium text-void-fg-1">{name}</div>
				</div>

				{/* Right side - power toggle switch */}
				<VoidSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>

			{/* Tools section */}
			{isOn && (
				<div className="mt-3">
					<div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
						{(server.tools ?? []).length > 0 ? (
							(server.tools ?? []).map((tool: { name: string; description?: string }) => (
								<span
									key={tool.name}
									className="px-2 py-0.5 bg-void-bg-2 text-void-fg-3 rounded-sm text-xs"

									data-tooltip-id='void-tooltip'
									data-tooltip-content={tool.description || ''}
									data-tooltip-class-name='void-max-w-[300px]'
								>
									{removeUniquePrefix(tool.name)}
								</span>
							))
						) : (
							<span className="text-xs text-void-fg-3">No tools available</span>
						)}
					</div>
				</div>
			)}

			{/* Command badge */}
			{isOn && server.command && (
				<div className="mt-3">
					<div className="text-xs text-void-fg-3 mb-1">Command:</div>
					<div className="px-2 py-1 bg-void-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-void-fg-2 rounded-sm">
						{server.command}
					</div>
				</div>
			)}

			{/* Error message if present */}
			{server.error && (
				<div className="mt-3">
					<WarningBox text={server.error} />
				</div>
			)}
		</div>
	);
};

// Main component that renders the list of servers
const MCPServersList = () => {
	const mcpServiceState = useMCPServiceState()

	let content: React.ReactNode
	if (mcpServiceState.error) {
		content = <div className="text-void-fg-3 text-sm mt-2">
			{mcpServiceState.error}
		</div>
	}
	else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		if (entries.length === 0) {
			content = <div className="text-void-fg-3 text-sm mt-2">
				No servers found
			</div>
		}
		else {
			content = entries.map(([name, server]) => (
				<MCPServerComponent key={name} name={name} server={server} />
			))
		}
	}

	return <div className="my-2">{content}</div>
};

export const Settings = () => {
	const isDark = useIsDark()
	// ─── sidebar nav ──────────────────────────
	const [selectedSection, setSelectedSection] =
		useState<Tab>('models');

	const navItems: { tab: Tab; label: string }[] = [
		{ tab: 'models', label: 'Models' },
		{ tab: 'localProviders', label: 'Local Providers' },
		{ tab: 'providers', label: 'Main Providers' },
		{ tab: 'featureOptions', label: 'Feature Options' },
		{ tab: 'general', label: 'General' },
		{ tab: 'mcp', label: 'MCP' },
		{ tab: 'all', label: 'All Settings' },
	];
	const shouldShowTab = (tab: Tab) => selectedSection === 'all' || selectedSection === tab;
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const mcpService = accessor.get('IMCPService')
	const storageService = accessor.get('IStorageService')
	const metricsService = accessor.get('IMetricsService')
	const isOptedOut = useIsOptedOut()

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			// Export chat threads
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'void-chats.json'
		}
		else if (t === 'Settings') {
			// Export user settings
			dataStr = JSON.stringify(voidSettingsService.state, null, 2)
			downloadName = 'void-settings.json'
		}
		else {
			dataStr = ''
			downloadName = ''
		}

		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}


	// Add file input refs
	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)

	const [s, ss] = useState(0)

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>,) => {
		const files = e.target.files
		if (!files) return;
		const file = files[0]
		if (!file) return

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string);

				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				}
				else if (t === 'Settings') {
					voidSettingsService.dangerousSetState(json as any)
				}

				notificationService.info(`${t} imported successfully!`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error, })
			}
		};
		reader.readAsText(file);
		e.target.value = '';

		ss(s => s + 1)
	}


	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', overflow: 'auto' }}>
			<div className="flex flex-col md:flex-row w-full gap-6 max-w-[900px] mx-auto mb-32" style={{ minHeight: '80vh' }}>
				{/* ──────────────  SIDEBAR  ────────────── */}

				<aside className="md:w-1/4 w-full p-6 shrink-0">
					{/* vertical tab list */}
					<div className="flex flex-col gap-2 mt-12">
						{navItems.map(({ tab, label }) => (
							<button
								key={tab}
								onClick={() => {
									if (tab === 'all') {
										setSelectedSection('all');
										window.scrollTo({ top: 0, behavior: 'smooth' });
									} else {
										setSelectedSection(tab);
									}
								}}
								className={`
          py-2 px-4 rounded-md text-left transition-all duration-200
          ${selectedSection === tab
										? 'bg-[#0e70c0]/80 text-white font-medium shadow-sm'
										: 'bg-void-bg-2 hover:bg-void-bg-2/80 text-void-fg-1'}
        `}
							>
								{label}
							</button>
						))}
					</div>
				</aside>

				{/* ───────────── MAIN PANE ───────────── */}
				<main className="flex-1 p-6 select-none">



					<div className='max-w-3xl'>

						<h1 className='text-2xl w-full'>{`Vader's Settings`}</h1>

						<div className='w-full h-[1px] my-2' />

						{/* Models section (formerly FeaturesTab) */}
						<ErrorBoundary>
							<RedoOnboardingButton />
						</ErrorBoundary>

						<div className='w-full h-[1px] my-4' />

						{/* All sections in flex container with gap-12 */}
						<div className='flex flex-col gap-12'>
							{/* Models section (formerly FeaturesTab) */}
							<div className={shouldShowTab('models') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Models</h2>
									<ModelDump />
									<div className='w-full h-[1px] my-4' />
									<AutoDetectLocalModelsToggle />
									<RefreshableModels />
								</ErrorBoundary>
							</div>

							{/* Local Providers section */}
							<div className={shouldShowTab('localProviders') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Local Providers</h2>
									<h3 className={`text-void-fg-3 mb-2`}>{`Vader can access any model that you host locally. We automatically detect your local models by default.`}</h3>

									<div className='opacity-80 mb-4'>
										<OllamaSetupInstructions sayWeAutoDetect={true} />
									</div>

									<VoidProviderSettings providerNames={localProviderNames} />
								</ErrorBoundary>
							</div>

							{/* Main Providers section */}
							<div className={shouldShowTab('providers') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Main Providers</h2>
									<h3 className={`text-void-fg-3 mb-2`}>{`Vader can access models from Anthropic, OpenAI, OpenRouter, and more.`}</h3>

									<VoidProviderSettings providerNames={nonlocalProviderNames} />
								</ErrorBoundary>
							</div>

							{/* Feature Options section */}
							<div className={shouldShowTab('featureOptions') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Feature Options</h2>

									<div className='flex flex-col gap-y-8 my-4'>
										<ErrorBoundary>
											{/* FIM */}
											<div>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
												<div className='text-sm text-void-fg-3 mt-1'>
													<span>
														Experimental.{' '}
													</span>
													<span
														className='hover:brightness-110'
														data-tooltip-id='void-tooltip'
														data-tooltip-content='We recommend using the largest qwen2.5-coder model you can with Ollama (try qwen2.5-coder:3b).'
														data-tooltip-class-name='void-max-w-[20px]'
													>
														Only works with FIM models.*
													</span>
												</div>

												<div className='my-2'>
													{/* Enable Switch */}
													<ErrorBoundary>
														<div className='flex items-center gap-x-2 my-2'>
															<VoidSwitch
																size='xs'
																value={settingsState.globalSettings.enableAutocomplete}
																onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
															/>
															<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.enableAutocomplete ? 'Enabled' : 'Disabled'}</span>
														</div>
													</ErrorBoundary>

													{/* Model Dropdown */}
													<ErrorBoundary>
														<div className={`my-2 ${!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}>
															<ModelDropdown featureName={'Autocomplete'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
														</div>
													</ErrorBoundary>

												</div>

											</div>
										</ErrorBoundary>

										{/* Apply */}
										<ErrorBoundary>

											<div className='w-full'>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('Apply')}</h4>
												<div className='text-sm text-void-fg-3 mt-1'>Settings that control the behavior of the Apply button.</div>

												<div className='my-2'>
													{/* Sync to Chat Switch */}
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.syncApplyToChat}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncApplyToChat ? 'Same as Chat model' : 'Different model'}</span>
													</div>

													{/* Model Dropdown */}
													<div className={`my-2 ${settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}>
														<ModelDropdown featureName={'Apply'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
													</div>
												</div>


												<div className='my-2'>
													{/* Fast Apply Method Dropdown */}
													<div className='flex items-center gap-x-2 my-2'>
														<FastApplyMethodDropdown />
													</div>
												</div>

											</div>
										</ErrorBoundary>




										{/* Tools Section */}
										<div>
											<h4 className={`text-base`}>Tools</h4>
											<div className='text-sm text-void-fg-3 mt-1'>{`Tools are functions that LLMs can call. Some tools require user approval.`}</div>

											<div className='my-2'>
												{/* Auto Accept Switch */}
												<ErrorBoundary>
													{[...toolApprovalTypes].map((approvalType) => {
														return <div key={approvalType} className="flex items-center gap-x-2 my-2">
															<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
														</div>
													})}

												</ErrorBoundary>

												{/* Tool Lint Errors Switch */}
												<ErrorBoundary>

													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.includeToolLintErrors}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.includeToolLintErrors ? 'Fix lint errors' : `Fix lint errors`}</span>
													</div>
												</ErrorBoundary>

												{/* Auto Accept LLM Changes Switch */}
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.autoAcceptLLMChanges}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>Auto-accept LLM changes</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>



										<div className='w-full'>
											<h4 className={`text-base`}>Editor</h4>
											<div className='text-sm text-void-fg-3 mt-1'>{`Settings that control the visibility of Vader suggestions in the code editor.`}</div>

											<div className='my-2'>
												{/* Auto Accept Switch */}
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.showInlineSuggestions}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.showInlineSuggestions ? 'Show suggestions on select' : 'Show suggestions on select'}</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>

										{/* SCM */}
										<ErrorBoundary>

											<div className='w-full'>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('SCM')}</h4>
												<div className='text-sm text-void-fg-3 mt-1'>Settings that control the behavior of the commit message generator.</div>

												<div className='my-2'>
													{/* Sync to Chat Switch */}
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.syncSCMToChat}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('syncSCMToChat', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncSCMToChat ? 'Same as Chat model' : 'Different model'}</span>
													</div>

													{/* Model Dropdown */}
													<div className={`my-2 ${settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''}`}>
														<ModelDropdown featureName={'SCM'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
													</div>
												</div>

											</div>
										</ErrorBoundary>
									</div>
								</ErrorBoundary>
							</div>

							{/* General section */}
							<div className={`${shouldShowTab('general') ? `` : 'hidden'} flex flex-col gap-12`}>
								{/* One-Click Switch section */}
								<div>
									<ErrorBoundary>
										<h2 className='text-3xl mb-2'>One-Click Switch</h2>
										<h4 className='text-void-fg-3 mb-4'>{`Transfer your editor settings into Vader.`}</h4>

										<div className='flex flex-col gap-2'>
											<OneClickSwitchButton className='w-48' fromEditor="VS Code" />
											<OneClickSwitchButton className='w-48' fromEditor="Cursor" />
											<OneClickSwitchButton className='w-48' fromEditor="Windsurf" />
										</div>
									</ErrorBoundary>
								</div>

								{/* Import/Export section */}
								<div>
									<h2 className='text-3xl mb-2'>Import/Export</h2>
									<h4 className='text-void-fg-3 mb-4'>{`Transfer Vader's settings and chats in and out of Vader.`}</h4>
									<div className='flex flex-col gap-8'>
										{/* Settings Subcategory */}
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputSettingsRef.current?.click() }}>
												Import Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Settings')}>
												Export Settings
											</VoidButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { voidSettingsService.resetState(); }}>
												Reset Settings
											</ConfirmButton>
										</div>

										{/* Chats Subcategory */}
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputChatsRef.current?.click() }}>
												Import Chats
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Chats')}>
												Export Chats
											</VoidButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { chatThreadsService.resetState(); }}>
												Reset Chats
											</ConfirmButton>
										</div>
									</div>
								</div>



								{/* Built-in Settings section */}
								<div>
									<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
									<h4 className={`text-void-fg-3 mb-4`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

									<ErrorBoundary>
										<div className='flex flex-col gap-2 justify-center max-w-48 w-full'>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
												General Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
												Keyboard Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
												Theme Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
												Open Logs
											</VoidButtonBgDarken>
										</div>
									</ErrorBoundary>
								</div>


								{/* Metrics section */}
								<div className='max-w-[600px]'>
									<h2 className={`text-3xl mb-2`}>Metrics</h2>
									<h4 className={`text-void-fg-3 mb-4`}>Vader does not send anonymous usage metrics to any external analytics service (unlike upstream Void, which reported basic usage to its own analytics by default). This toggle only sets a local flag for compatibility; it does not transmit anything regardless of its value. Vader never sees your code, messages, or API keys.</h4>

									<div className='my-2'>
										{/* Disable All Metrics Switch */}
										<ErrorBoundary>
											<div className='flex items-center gap-x-2 my-2'>
												<VoidSwitch
													size='xs'
													value={isOptedOut}
													onChange={(newVal) => {
														storageService.store(OPT_OUT_KEY, newVal, StorageScope.APPLICATION, StorageTarget.MACHINE)
														metricsService.capture(`Set metrics opt-out to ${newVal}`, {}) // this only fires if it's enabled, so it's fine to have here
													}}
												/>
												<span className='text-void-fg-3 text-xs pointer-events-none'>{'Opt-out (requires restart)'}</span>
											</div>
										</ErrorBoundary>
									</div>
								</div>

								<AgentsAndPolicySection />

								<ModelRouterSection />

								<SkillsSection />

								<MemorySection />

								<AgentManagerSection />

								{/* AI Instructions section */}
								<div className='max-w-[600px]'>
									<h2 className={`text-3xl mb-2`}>AI Instructions</h2>
									<h4 className={`text-void-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
System instructions to include with all AI requests.
Alternatively, place a \`.vaderrules\` file (or legacy \`.voidrules\`) in the root of your workspace.
								`} chatMessageLocation={undefined} />
									</h4>
									<ErrorBoundary>
										<AIInstructionsBox />
									</ErrorBoundary>
									{/* --- Disable System Message Toggle --- */}
									<div className='my-4'>
										<ErrorBoundary>
											<div className='flex items-center gap-x-2'>
												<VoidSwitch
													size='xs'
													value={!!settingsState.globalSettings.disableSystemMessage}
													onChange={(newValue) => {
														voidSettingsService.setGlobalSetting('disableSystemMessage', newValue);
													}}
												/>
												<span className='text-void-fg-3 text-xs pointer-events-none'>
													{'Disable system message'}
												</span>
											</div>
										</ErrorBoundary>
										<div className='text-void-fg-3 text-xs mt-1'>
											{`When disabled, Vader will not include anything in the system message except for content you specified above.`}
										</div>
									</div>
								</div>

							</div>



							{/* MCP section */}
							<div className={shouldShowTab('mcp') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className='text-3xl mb-2'>MCP</h2>
									<h4 className={`text-void-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
Use Model Context Protocol to provide Agent mode with more tools.
							`} chatMessageLocation={undefined} />
									</h4>
									<div className='my-2'>
										<VoidButtonBgDarken className='px-4 py-1 w-full max-w-48' onClick={async () => { await mcpService.revealMCPConfigFile() }}>
											Add MCP Server
										</VoidButtonBgDarken>
									</div>

									<ErrorBoundary>
										<MCPServersList />
									</ErrorBoundary>
								</ErrorBoundary>
							</div>





						</div>

					</div>
				</main>
			</div>
		</div>
	);
}
